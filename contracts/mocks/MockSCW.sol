// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Mock SCW for testing passthrough functionality
contract MockSCW {
    // Storage slot that will be in the EOA's storage (via delegatecall)
    uint256 public scwValue;

    event SCWFunctionCalled(address caller, uint256 value);

    function setSCWValue(uint256 value) external {
        scwValue = value;
        emit SCWFunctionCalled(msg.sender, value);
    }

    function getSCWValue() external view returns (uint256) {
        return scwValue;
    }

    // Simulates a function that validates msg.sender (like Safe's execTransaction)
    function validateAndExecute(address expected) external view returns (bool) {
        return msg.sender == expected;
    }
}
