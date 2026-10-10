// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Synthetic local-only fault injection token. Never part of the product build.
contract MockToken is ERC20 {
    mapping(address => bool) public blocked;
    bool public returnFalse;
    bool public chargeFee;
    address public callbackTarget;
    bytes public callbackData;
    bytes4 public callbackError;
    bool private inCallback;

    constructor() ERC20("LOCAL TEST ONLY", "TEST") {}
    function mint(address account, uint256 amount) external { _mint(account, amount); }
    function setBlocked(address account, bool value) external { blocked[account] = value; }
    function setReturnFalse(bool value) external { returnFalse = value; }
    function setChargeFee(bool value) external { chargeFee = value; }
    function setCallback(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
    function transfer(address to, uint256 amount) public override returns (bool) {
        if (returnFalse) return false;
        return super.transfer(to, amount);
    }
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (returnFalse) return false;
        return super.transferFrom(from, to, amount);
    }
    function _update(address from, address to, uint256 amount) internal override {
        require(!blocked[to], "MOCK_BLOCKED");
        if (callbackTarget != address(0) && !inCallback && from == callbackTarget) {
            inCallback = true;
            (bool ok, bytes memory result) = callbackTarget.call(callbackData);
            require(!ok, "REENTRY_SUCCEEDED");
            if (result.length >= 4) callbackError = bytes4(result);
            inCallback = false;
        }
        if (chargeFee && from != address(0) && to != address(0) && amount > 1) {
            super._update(from, to, amount - 1);
            super._update(from, address(0), 1);
        } else {
            super._update(from, to, amount);
        }
    }
}
