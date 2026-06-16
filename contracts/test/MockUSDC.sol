// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    bool public shouldReenter;
    address public targetMarket;
    
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setReenter(bool _shouldReenter, address _targetMarket) external {
        shouldReenter = _shouldReenter;
        targetMarket = _targetMarket;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool success = super.transfer(to, amount);
        if (shouldReenter && targetMarket != address(0)) {
            // attempt reentrancy
            (bool ok, ) = targetMarket.call(abi.encodeWithSignature("userWithdraw()"));
            require(ok, "reentry call failed");
        }
        return success;
    }
}
