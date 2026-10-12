// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Valueless internal test token, restricted to its constructor chain allowlist.
/// Fixed supply to deployer, no further mint, owner, freeze, upgrade, fee or recovery role.
contract InternalTestToken is ERC20 {
    uint256 public constant MAX_ALLOWED_CHAINS = 32;
    mapping(uint256 => bool) public allowedChain;
    error InvalidChainConfig();
    constructor(uint256[] memory allowedChainIds) ERC20("YBZ Internal Test Token", "YBZt") {
        if (allowedChainIds.length == 0 || allowedChainIds.length > MAX_ALLOWED_CHAINS) revert InvalidChainConfig();
        for (uint256 i; i < allowedChainIds.length; ++i) {
            uint256 chainId = allowedChainIds[i];
            if (chainId == 0 || allowedChain[chainId]) revert InvalidChainConfig();
            allowedChain[chainId] = true;
        }
        if (!allowedChain[block.chainid]) revert InvalidChainConfig();
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }
}
