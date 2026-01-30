// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LivenessGuard
/// @notice Minimal EIP-7702 dead-man switch. Silence is not consent.
/// @dev Guardian can initiate recovery, user can veto by calling cancelRecovery.
///      Time alone should never cause asset movement - recovery requires human action.
contract LivenessGuard {
    // Immutables (set at deployment)
    address public immutable guardian;
    uint256 public immutable recoveryDelay;

    // Storage: 1 slot per EOA
    // 0 = normal, >0 = recovery pending (timestamp when initiated)
    uint256 public recoveryInitiatedAt;

    // Authorized executors (can call execute after recovery)
    mapping(address => bool) public isExecutor;

    event RecoveryInitiated(uint256 timestamp);
    event RecoveryCancelled();
    event Executed(address indexed to, uint256 value, bytes data);
    event ExecutorAdded(address indexed executor);
    event ExecutorRemoved(address indexed executor);

    error NotGuardian();
    error NotAuthorized();
    error NotSelf();
    error RecoveryNotInitiated();
    error RecoveryAlreadyInitiated();
    error RecoveryDelayNotPassed();
    error ExecutionFailed();

    constructor(address _guardian, uint256 _recoveryDelay) {
        guardian = _guardian;
        recoveryDelay = _recoveryDelay;
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
    function initiateRecovery() external {
        if (msg.sender != guardian) revert NotGuardian();
        if (recoveryInitiatedAt != 0) revert RecoveryAlreadyInitiated();

        recoveryInitiatedAt = block.timestamp;
        emit RecoveryInitiated(block.timestamp);
    }

    /// @notice Guardian or authorized executor executes after recovery delay has passed
    /// @param to Target address
    /// @param value ETH value to send
    /// @param data Calldata to execute
    function execute(address to, uint256 value, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != guardian && !isExecutor[msg.sender]) revert NotAuthorized();
        if (recoveryInitiatedAt == 0) revert RecoveryNotInitiated();
        if (block.timestamp < recoveryInitiatedAt + recoveryDelay) revert RecoveryDelayNotPassed();

        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) revert ExecutionFailed();

        emit Executed(to, value, data);
        return result;
    }

    /// @notice Guardian adds an authorized executor (only after recovery delay)
    /// @param executor Address to authorize
    function addExecutor(address executor) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (recoveryInitiatedAt == 0) revert RecoveryNotInitiated();
        if (block.timestamp < recoveryInitiatedAt + recoveryDelay) revert RecoveryDelayNotPassed();

        isExecutor[executor] = true;
        emit ExecutorAdded(executor);
    }

    /// @notice Guardian removes an authorized executor
    /// @param executor Address to remove
    function removeExecutor(address executor) external {
        if (msg.sender != guardian) revert NotGuardian();

        isExecutor[executor] = false;
        emit ExecutorRemoved(executor);
    }

    /// @notice Accept ETH transfers
    receive() external payable {}
}
