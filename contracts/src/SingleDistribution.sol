// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice One immutable, ERC20-only campaign. No owner, upgrade, sweep, or admin withdrawal.
/// @dev Experimental: all-reveal-or-refund prevents subset fallback but NOT selective-abort bias.
/// Only exact-transfer, non-rebasing, reviewed ERC20s are supported. See README before use.
contract SingleDistribution is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_WINDOW = 60;
    uint256 public constant MAX_RECIPIENTS = 200;
    uint256 public constant BPS = 10_000;
    bytes32 public constant COMMIT_TAG = keccak256("YUBENZHE_DISTRIBUTION_COMMIT_V1");
    bytes32 public constant LEAF_TAG = keccak256("YUBENZHE_DISTRIBUTION_LEAF_V1");
    bytes32 public constant ENTROPY_TAG = keccak256("YUBENZHE_DISTRIBUTION_ENTROPY_V1");

    enum Phase { Locked, Active, Closed }

    struct Config {
        IERC20 token;
        bytes32 campaignId;
        bytes32 whitelistRoot;
        uint128 amount;
        uint16 recipientCount;
        uint64 commitStart;
        uint64 commitEnd;
        uint64 revealEnd;
        uint64 expiresAt;
        uint64 decayDuration;
        uint16 initialPenaltyBps;
    }

    struct Participant {
        address account;
        bytes32 commitment;
        bool revealed;
        bool claimed;
        uint256 allocation;
        uint256 received;
    }

    IERC20 public immutable token;
    address public immutable sender;
    bytes32 public immutable campaignId;
    bytes32 public immutable whitelistRoot;
    bytes32 public immutable domain;
    uint256 public immutable totalAmount;
    uint256 public immutable recipientCount;
    uint256 public immutable commitStart;
    uint256 public immutable commitEnd;
    uint256 public immutable revealEnd;
    uint256 public immutable expiresAt;
    uint256 public immutable decayDuration;
    uint256 public immutable initialPenaltyBps;

    bool public funded;
    bool public finalized;
    bool public refunded;
    uint256 public committedCount;
    uint256 public revealedCount;
    uint256 public claimedCount;
    uint256 public remaining;
    uint256 public totalPaid;
    uint256 public totalRefunded;
    bytes32 private entropyXor;
    bytes32 public seed;
    mapping(uint256 => Participant) public participants;
    mapping(address => bool) public hasCommitted;

    error InvalidConfig();
    error WrongPhase();
    error Unauthorized();
    error InvalidProof();
    error InvalidCommitment();
    error DuplicateAction();
    error IncompleteReveals();
    error UnsupportedToken();
    error ZeroPayout();

    event Funded(address indexed sender, uint256 amount);
    event Committed(uint256 indexed index, address indexed account);
    event Revealed(uint256 indexed index);
    event Finalized(bytes32 seed);
    event Claimed(uint256 indexed index, address indexed recipient, uint256 paid, uint256 penalty);
    event Refunded(address indexed sender, uint256 amount);

    constructor(Config memory c) {
        if (address(c.token).code.length == 0 || c.campaignId == bytes32(0)
            || c.whitelistRoot == bytes32(0) || c.recipientCount < 2
            || c.recipientCount > MAX_RECIPIENTS || c.amount < c.recipientCount
            || c.commitStart < block.timestamp + MIN_WINDOW
            || c.commitEnd < uint256(c.commitStart) + MIN_WINDOW
            || c.revealEnd < uint256(c.commitEnd) + MIN_WINDOW
            || c.decayDuration < MIN_WINDOW
            || c.expiresAt < uint256(c.revealEnd) + c.decayDuration + MIN_WINDOW
            || c.initialPenaltyBps == 0 || c.initialPenaltyBps > 9_000) revert InvalidConfig();
        token = c.token;
        sender = msg.sender;
        campaignId = c.campaignId;
        whitelistRoot = c.whitelistRoot;
        totalAmount = c.amount;
        recipientCount = c.recipientCount;
        commitStart = c.commitStart;
        commitEnd = c.commitEnd;
        revealEnd = c.revealEnd;
        expiresAt = c.expiresAt;
        decayDuration = c.decayDuration;
        initialPenaltyBps = c.initialPenaltyBps;
        domain = keccak256(abi.encode(block.chainid, address(this), msg.sender, c.campaignId));
    }

    /// @notice Sender approves this contract then signs fund(). Funding is all-or-nothing.
    function fund() external nonReentrant {
        if (msg.sender != sender) revert Unauthorized();
        if (funded) revert DuplicateAction();
        if (block.timestamp + MIN_WINDOW > commitStart) revert WrongPhase();
        uint256 beforeBalance = token.balanceOf(address(this));
        funded = true;
        remaining = totalAmount;
        token.safeTransferFrom(sender, address(this), totalAmount);
        if (token.balanceOf(address(this)) != beforeBalance + totalAmount) revert UnsupportedToken();
        emit Funded(sender, totalAmount);
    }

    /// @dev Salted double-hashed leaf prevents leaf/internal-node ambiguity. Invitations are
    /// access control, not anonymity: the account and salt become public on commit.
    function whitelistLeaf(uint256 index, address account, bytes32 invitationSalt) public view returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(
            LEAF_TAG, block.chainid, sender, campaignId, index, account, invitationSalt
        ))));
    }

    function commitmentFor(uint256 index, address account, bytes32 secret) public view returns (bytes32) {
        return keccak256(abi.encode(COMMIT_TAG, domain, index, account, secret));
    }

    /// @notice Fixed, unique slots. No first-come selection and no replacements after commit.
    function commit(uint256 index, bytes32 commitment, bytes32 invitationSalt, bytes32[] calldata proof)
        external nonReentrant
    {
        if (!funded || block.timestamp < commitStart || block.timestamp >= commitEnd) revert WrongPhase();
        if (msg.sender == sender) revert Unauthorized();
        if (index >= recipientCount || commitment == bytes32(0)) revert InvalidCommitment();
        if (participants[index].account != address(0) || hasCommitted[msg.sender]) revert DuplicateAction();
        if (!MerkleProof.verifyCalldata(proof, whitelistRoot, whitelistLeaf(index, msg.sender, invitationSalt))) {
            revert InvalidProof();
        }
        hasCommitted[msg.sender] = true;
        participants[index].account = msg.sender;
        participants[index].commitment = commitment;
        committedCount++;
        emit Committed(index, msg.sender);
    }

    /// @notice Reveal only after EVERY commitment is frozen. Missing reveals cause a refund,
    /// never a new draw, subset seed, blockhash, timestamp, or administrator fallback.
    function reveal(uint256 index, bytes32 secret) external nonReentrant {
        if (!funded || block.timestamp < commitEnd || block.timestamp >= revealEnd) revert WrongPhase();
        if (committedCount != recipientCount) revert IncompleteReveals();
        Participant storage p = participants[index];
        if (p.account != msg.sender) revert Unauthorized();
        if (p.revealed) revert DuplicateAction();
        if (p.commitment != commitmentFor(index, msg.sender, secret)) revert InvalidCommitment();
        p.revealed = true;
        revealedCount++;
        // Domain and fixed index prevent copy/XOR cancellation; XOR makes reveal order irrelevant.
        entropyXor ^= keccak256(abi.encode(ENTROPY_TAG, domain, index, msg.sender, secret));
        emit Revealed(index);
    }

    /// @notice Anyone can finalize once the fixed reveal window closes; at most 200 slots.
    function finalize() external nonReentrant {
        if (!funded || block.timestamp < revealEnd || block.timestamp >= expiresAt) revert WrongPhase();
        if (finalized) revert DuplicateAction();
        if (revealedCount != recipientCount) revert IncompleteReveals();
        finalized = true;
        seed = keccak256(abi.encode(ENTROPY_TAG, domain, entropyXor));
        uint256[] memory weights = new uint256[](recipientCount);
        uint256 sum;
        for (uint256 i; i < recipientCount; ++i) {
            weights[i] = 1 + uint256(keccak256(abi.encode(seed, i))) % 1_000_000;
            sum += weights[i];
        }
        uint256 allocated;
        uint256 variablePool = totalAmount - recipientCount;
        for (uint256 i; i < recipientCount; ++i) {
            // totalAmount is capped at uint128, weight <= 1e6: product fits uint256.
            uint256 allocation = 1 + variablePool * weights[i] / sum;
            participants[i].allocation = allocation;
            allocated += allocation;
        }
        // Give rounding dust to one predetermined slot, never to the last transaction.
        uint256 dustSlot = uint256(keccak256(abi.encode(seed, "DUST"))) % recipientCount;
        participants[dustSlot].allocation += totalAmount - allocated;
        emit Finalized(seed);
    }

    /// @notice Early-claim penalty declines linearly to zero. Waiting cannot steal another slot.
    function penaltyBpsAt(uint256 timestamp) public view returns (uint256) {
        if (timestamp <= revealEnd) return initialPenaltyBps;
        if (timestamp >= revealEnd + decayDuration) return 0;
        return initialPenaltyBps * (revealEnd + decayDuration - timestamp) / decayDuration;
    }

    function claimable(uint256 index) external view returns (uint256) {
        Participant storage p = participants[index];
        if (!finalized || refunded || p.claimed || block.timestamp >= expiresAt) return 0;
        return p.allocation * (BPS - penaltyBpsAt(block.timestamp)) / BPS;
    }

    /// @notice Transfers only to the original whitelist account. Revert means retryable:
    /// no claim/remaining changes survive a failed token transfer or unsupported balance delta.
    function claim(uint256 index) external nonReentrant {
        if (!finalized || refunded || block.timestamp < revealEnd || block.timestamp >= expiresAt) revert WrongPhase();
        Participant storage p = participants[index];
        if (p.account != msg.sender) revert Unauthorized();
        if (p.claimed) revert DuplicateAction();
        uint256 payout = p.allocation * (BPS - penaltyBpsAt(block.timestamp)) / BPS;
        if (payout == 0) revert ZeroPayout();
        p.claimed = true;
        p.received = payout;
        claimedCount++;
        remaining -= payout;
        totalPaid += payout;
        _transferExact(msg.sender, payout);
        emit Claimed(index, msg.sender, payout, p.allocation - payout);
    }

    /// @notice Permissionless trigger, immutable sender destination. No early cancellation.
    /// Includes unclaimed allocations and early-claim penalties; failed refund may be retried.
    function refundExpired() external nonReentrant {
        if (!funded || block.timestamp < expiresAt) revert WrongPhase();
        if (refunded) revert DuplicateAction();
        refunded = true;
        uint256 amount = remaining;
        remaining = 0;
        totalRefunded += amount;
        if (amount != 0) _transferExact(sender, amount);
        emit Refunded(sender, amount);
    }

    function phase() external view returns (Phase) {
        if (refunded || (funded && remaining == 0) || block.timestamp >= expiresAt) return Phase.Closed;
        if (finalized) return Phase.Active;
        return Phase.Locked;
    }

    function _transferExact(address recipient, uint256 amount) private {
        uint256 beforeContract = token.balanceOf(address(this));
        uint256 beforeRecipient = token.balanceOf(recipient);
        token.safeTransfer(recipient, amount);
        if (token.balanceOf(address(this)) != beforeContract - amount
            || token.balanceOf(recipient) != beforeRecipient + amount) revert UnsupportedToken();
    }
}
