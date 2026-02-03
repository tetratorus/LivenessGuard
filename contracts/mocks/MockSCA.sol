// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock SCA for testing passthrough functionality
contract MockSCA {
    // Storage slot that will be in the EOA's storage (via delegatecall)
    uint256 public scaValue;

    event SCAFunctionCalled(address caller, uint256 value);

    function setSCAValue(uint256 value) external {
        scaValue = value;
        emit SCAFunctionCalled(msg.sender, value);
    }

    function getSCAValue() external view returns (uint256) {
        return scaValue;
    }

    // Simulates a function that validates msg.sender (like Safe's execTransaction)
    function validateAndExecute(address expected) external view returns (bool) {
        return msg.sender == expected;
    }
}
