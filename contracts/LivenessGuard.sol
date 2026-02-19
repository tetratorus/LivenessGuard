// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LivenessGuard
/// @notice Minimal EIP-7702 dead-man switch with SCW passthrough.
/// @dev Guardian can initiate recovery, user can veto by calling cancelRecovery.
///      Time alone should never cause asset movement - recovery requires human action.
///      After recovery delay, guardian has a limited window (1 day) to execute.
///      Supports passthrough to underlying SCW (Safe, ERC-4337, etc.) via fallback.
contract LivenessGuard {
    // Immutables (set at deployment)
    address public immutable guardian;
    uint256 public immutable recoveryDelay;

    // Constants
    uint256 constant RECOVERY_WINDOW = 7 days;

    // Storage per EOA
    uint256 public recoveryInitiatedAt; // 0 = normal, >0 = recovery pending
    address public implementation;      // Underlying SCW (Safe, etc.) for passthrough

    // Authorized operators (can call execute after recovery)
    mapping(address => bool) public isOperator;

    event RecoveryInitiated(uint256 timestamp);
    event RecoveryCancelled();
    event Executed(address indexed to, uint256 value, bytes data);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);
    event ImplementationSet(address indexed implementation);

    error NotGuardian();
    error NotAuthorized();
    error NotSelf();
    error RecoveryNotInitiated();
    error RecoveryAlreadyInitiated();
    error RecoveryDelayNotPassed();
    error RecoveryWindowExpired();
    error ExecutionFailed();

    constructor(address _guardian, uint256 _recoveryDelay) {
        guardian = _guardian;
        recoveryDelay = _recoveryDelay;
    }

    /// @notice Set the underlying SCW implementation for passthrough
    /// @dev Only callable by the EOA owner (msg.sender == address(this))
    /// @param impl Address of the SCW implementation (Safe, ERC-4337, etc.)
    function setImplementation(address impl) external {
        if (msg.sender != address(this)) revert NotSelf();
        implementation = impl;
        emit ImplementationSet(impl);
    }

    /// @notice User cancels recovery by calling on their own EOA
    /// @dev msg.sender == address(this) proves key possession via EIP-7702
    function cancelRecovery() external {
        if (msg.sender != address(this)) revert NotSelf();
        if (recoveryInitiatedAt == 0) revert RecoveryNotInitiated();

        recoveryInitiatedAt = 0;
        emit RecoveryCancelled();
    }

    /// @notice Guardian initiates recovery process
    /// @dev Can re-initiate if the previous recovery window has expired
    function initiateRecovery() external {
        if (msg.sender != guardian) revert NotGuardian();
        if (recoveryInitiatedAt != 0) {
            if (block.timestamp <= recoveryInitiatedAt + recoveryDelay + RECOVERY_WINDOW) revert RecoveryAlreadyInitiated();
        }

        recoveryInitiatedAt = block.timestamp;
        emit RecoveryInitiated(block.timestamp);
    }

    /// @notice Guardian or authorized operator executes after recovery delay has passed
    /// @dev Must be called within RECOVERY_WINDOW (1 day) after delay elapses
    /// @param to Target address
    /// @param value ETH value to send
    /// @param data Calldata to execute
    function execute(address to, uint256 value, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != guardian && !isOperator[msg.sender]) revert NotAuthorized();
        if (recoveryInitiatedAt == 0) revert RecoveryNotInitiated();
        if (block.timestamp < recoveryInitiatedAt + recoveryDelay) revert RecoveryDelayNotPassed();
        if (block.timestamp > recoveryInitiatedAt + recoveryDelay + RECOVERY_WINDOW) revert RecoveryWindowExpired();

        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) revert ExecutionFailed();

        emit Executed(to, value, data);
        return result;
    }

    /// @notice Guardian adds an authorized operator (only within recovery window)
    /// @param operator Address to authorize
    function addOperator(address operator) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (recoveryInitiatedAt == 0) revert RecoveryNotInitiated();
        if (block.timestamp < recoveryInitiatedAt + recoveryDelay) revert RecoveryDelayNotPassed();
        if (block.timestamp > recoveryInitiatedAt + recoveryDelay + RECOVERY_WINDOW) revert RecoveryWindowExpired();

        isOperator[operator] = true;
        emit OperatorAdded(operator);
    }

    /// @notice Guardian removes an authorized operator
    /// @param operator Address to remove
    function removeOperator(address operator) external {
        if (msg.sender != guardian) revert NotGuardian();

        isOperator[operator] = false;
        emit OperatorRemoved(operator);
    }

    /// @notice Accept ETH transfers
    receive() external payable {}

    /// @notice Passthrough to underlying SCW implementation
    /// @dev Delegatecalls to implementation for any function not defined on LivenessGuard
    fallback() external payable {
        address impl = implementation;
        if (impl == address(0)) return;

        assembly {
            // Copy calldata to memory
            calldatacopy(0, 0, calldatasize())

            // Delegatecall to implementation
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)

            // Copy returndata to memory
            returndatacopy(0, 0, returndatasize())

            // Return or revert based on result
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
