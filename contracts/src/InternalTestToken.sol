// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Valueless internal test token, deployable only on BSC testnet (97).
/// Fixed supply to deployer, no further mint, owner, freeze, upgrade, fee or recovery role.
contract InternalTestToken is ERC20 {
    error TestnetOnly();
    constructor() ERC20("YBZ Internal Test Token", "YBZt") {
        if (block.chainid != 97) revert TestnetOnly();
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }
}
