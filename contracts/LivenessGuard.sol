// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LivenessGuard
/// @notice Minimal EIP-7702 dead-man switch with SCA passthrough.
/// @dev Guardian can initiate recovery, user can veto by calling cancelRecovery.
///      Time alone should never cause asset movement - recovery requires human action.
///      Uses delegate-then-activate model: 7702 delegation is inert until user activates.
///      Supports passthrough to underlying SCA (Safe, ERC-4337, etc.) via fallback.
contract LivenessGuard {
    // Immutables (set at deployment)
    address public immutable guardian;
    uint256 public immutable recoveryDelay;

    // Storage per EOA
    uint256 public activatedAt;         // 0 = inert, >0 = timestamp when activated
    uint256 public recoveryInitiatedAt; // 0 = normal, >0 = recovery pending
    address public implementation;      // Underlying SCA (Safe, etc.) for passthrough

    // Authorized operators (can call execute after recovery)
    mapping(address => bool) public isOperator;

    event Activated(uint256 timestamp);
    event RecoveryInitiated(uint256 timestamp);
    event RecoveryCancelled();
    event Executed(address indexed to, uint256 value, bytes data);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);
    event ImplementationSet(address indexed implementation);

    error NotGuardian();
    error NotAuthorized();
    error NotSelf();
    error NotActivated();
    error AlreadyActivated();
    error ActivationExpired();
    error InvalidSignature();
    error RecoveryNotInitiated();
    error RecoveryAlreadyInitiated();
    error RecoveryDelayNotPassed();
    error ExecutionFailed();

    bytes32 constant ACTIVATE_TYPEHASH = keccak256("Activate(address account,uint256 chainId,uint256 expiry)");

    constructor(address _guardian, uint256 _recoveryDelay) {
        guardian = _guardian;
        recoveryDelay = _recoveryDelay;
    }

    /// @notice Set the underlying SCA implementation for passthrough
    /// @dev Only callable by the EOA owner (msg.sender == address(this))
    /// @param impl Address of the SCA implementation (Safe, ERC-4337, etc.)
    function setImplementation(address impl) external {
        if (msg.sender != address(this)) revert NotSelf();
        implementation = impl;
        emit ImplementationSet(impl);
    }

    /// @notice Activate the guard with user signature (can be relayed by anyone)
    /// @dev Protects against 0-chainID 7702 attack - activation must happen within expiry
    /// @param expiry Timestamp after which activation is no longer valid
    /// @param sig User signature of keccak256(ACTIVATE_TYPEHASH, account, chainId, expiry)
    function activate(uint256 expiry, bytes calldata sig) external {
        if (activatedAt != 0) revert AlreadyActivated();
        if (block.timestamp > expiry) revert ActivationExpired();

        bytes32 hash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            keccak256(abi.encode(ACTIVATE_TYPEHASH, address(this), block.chainid, expiry))
        ));
        if (_recover(hash, sig) != address(this)) revert InvalidSignature();

        activatedAt = block.timestamp;
        emit Activated(block.timestamp);
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
        if (activatedAt == 0) revert NotActivated();
        if (recoveryInitiatedAt != 0) revert RecoveryAlreadyInitiated();

        recoveryInitiatedAt = block.timestamp;
        emit RecoveryInitiated(block.timestamp);
    }

    /// @notice Guardian or authorized operator executes after recovery delay has passed
    /// @param to Target address
    /// @param value ETH value to send
    /// @param data Calldata to execute
    function execute(address to, uint256 value, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != guardian && !isOperator[msg.sender]) revert NotAuthorized();
        if (recoveryInitiatedAt == 0) revert RecoveryNotInitiated();
        if (block.timestamp < recoveryInitiatedAt + recoveryDelay) revert RecoveryDelayNotPassed();

        (bool ok, bytes memory result) = to.call{value: value}(data);
        if (!ok) revert ExecutionFailed();

        emit Executed(to, value, data);
        return result;
    }

    /// @notice Guardian adds an authorized operator (only after recovery delay)
    /// @param operator Address to authorize
    function addOperator(address operator) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (recoveryInitiatedAt == 0) revert RecoveryNotInitiated();
        if (block.timestamp < recoveryInitiatedAt + recoveryDelay) revert RecoveryDelayNotPassed();

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

    /// @notice Passthrough to underlying SCA implementation
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

    function _recover(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(hash, v, r, s);
    }
}
