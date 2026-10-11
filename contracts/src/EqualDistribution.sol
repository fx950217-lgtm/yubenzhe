// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice One immutable equal distribution, with no owner, upgrade or arbitrary withdrawal.
/// @dev Internal testnet review only. Exact-transfer ERC20s; not audited for mainnet use.
contract EqualDistribution is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant MIN_WINDOW = 60;
    uint256 public constant MAX_RECIPIENTS = 200;
    struct Config {
        IERC20 token;
        bytes32 campaignId;
        uint128 amount;
        uint64 claimStart;
        uint64 expiresAt;
    }
    struct Participant {
        address account;
        bool claimed;
        uint256 allocation;
        uint256 received;
    }
    enum Phase { Locked, Active, Closed }
    IERC20 public immutable token;
    address public immutable sender;
    bytes32 public immutable campaignId;
    uint256 public immutable totalAmount;
    uint256 public immutable recipientCount;
    uint256 public immutable claimStart;
    uint256 public immutable expiresAt;
    bool public funded;
    bool public refunded;
    uint256 public claimedCount;
    uint256 public remaining;
    uint256 public totalPaid;
    uint256 public totalRefunded;
    mapping(uint256 => Participant) public participants;
    // 1-based index; zero means this address has no fixed slot.
    mapping(address => uint256) public recipientIndex;
    error InvalidConfig();
    error WrongPhase();
    error Unauthorized();
    error DuplicateAction();
    error UnsupportedToken();
    event Funded(address indexed sender, uint256 amount);
    event Claimed(uint256 indexed index, address indexed recipient, uint256 paid);
    event Refunded(address indexed sender, uint256 amount);

    constructor(Config memory c, address[] memory recipients) {
        uint256 count = recipients.length;
        if (block.chainid != 97 || address(c.token).code.length == 0 || c.campaignId == bytes32(0)
            || count == 0 || count > MAX_RECIPIENTS || c.amount < count
            || c.claimStart < block.timestamp + MIN_WINDOW
            || c.expiresAt < uint256(c.claimStart) + MIN_WINDOW) revert InvalidConfig();
        token = c.token;
        sender = msg.sender;
        campaignId = c.campaignId;
        totalAmount = c.amount;
        recipientCount = count;
        claimStart = c.claimStart;
        expiresAt = c.expiresAt;
        uint256 base = c.amount / count;
        uint256 dust = c.amount % count;
        for (uint256 i; i < count; ++i) {
            address account = recipients[i];
            if (account == address(0) || account == address(this) || account == msg.sender || recipientIndex[account] != 0) revert InvalidConfig();
            recipientIndex[account] = i + 1;
            participants[i] = Participant(account, false, base + (i < dust ? 1 : 0), 0);
        }
    }
    function fund() external nonReentrant {
        if (msg.sender != sender) revert Unauthorized();
        if (funded) revert DuplicateAction();
        if (block.timestamp + MIN_WINDOW > claimStart) revert WrongPhase();
        uint256 beforeBalance = token.balanceOf(address(this));
        funded = true;
        remaining = totalAmount;
        token.safeTransferFrom(sender, address(this), totalAmount);
        if (token.balanceOf(address(this)) != beforeBalance + totalAmount) revert UnsupportedToken();
        emit Funded(sender, totalAmount);
    }
    function claimable(uint256 index) external view returns (uint256) {
        Participant storage p = participants[index];
        if (!funded || refunded || p.claimed || block.timestamp < claimStart || block.timestamp >= expiresAt) return 0;
        return p.allocation;
    }
    function claim(uint256 index) external nonReentrant {
        if (!funded || refunded || block.timestamp < claimStart || block.timestamp >= expiresAt) revert WrongPhase();
        Participant storage p = participants[index];
        if (p.account != msg.sender) revert Unauthorized();
        if (p.claimed) revert DuplicateAction();
        p.claimed = true;
        p.received = p.allocation;
        claimedCount++;
        remaining -= p.allocation;
        totalPaid += p.allocation;
        _transferExact(msg.sender, p.allocation);
        emit Claimed(index, msg.sender, p.allocation);
    }
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
        if (funded && block.timestamp >= claimStart) return Phase.Active;
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
