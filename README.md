# Liveness Guard

Minimal EIP-7702 dead-man switch for EOA recovery.

## How It Works

1. User delegates their EOA to LivenessGuard via EIP-7702
2. User signs activation message with expiry (relayable by anyone)
3. Guardian (fixed at deployment) can initiate recovery
4. Long delay period (e.g., 30 days)
5. User can veto anytime by calling `cancelRecovery()` - proves key possession
6. After delay, guardian can `execute()` to move assets
7. Guardian can add operators to delegate execution rights

## SCA Passthrough

LivenessGuard supports passthrough to an underlying Smart Contract Account (Safe, ERC-4337, etc.):

```
EOA → EIP-7702 → LivenessGuard → Safe/ERC-4337
```

- User can set an implementation via `setImplementation(address)`
- Any function not defined on LivenessGuard is delegatecalled to the implementation
- LivenessGuard functions always take precedence
- Storage is in the EOA's context (via delegatecall)

## Contract

```solidity
// Immutables (set at deployment)
address immutable guardian;
uint256 immutable recoveryDelay;

// Storage per EOA
uint256 activatedAt;          // 0 = inert, >0 = active
uint256 recoveryInitiatedAt;  // 0 = normal, >0 = recovery pending
address implementation;       // Underlying SCA for passthrough
mapping(address => bool) isOperator;

// Functions
activate(expiry, sig)         // Anyone can relay user's signed activation
cancelRecovery()              // User only (msg.sender == address(this))
initiateRecovery()            // Guardian only, requires activated
execute(to, value, data)      // Guardian or operator, after delay
addOperator(operator)         // Guardian only, after delay
removeOperator(operator)      // Guardian only
setImplementation(impl)       // User only, sets SCA passthrough
```

## Usage

```bash
npm install
npm run compile
npm test
```

## Deterministic Deployment

Uses CREATE2 via [SAFE Singleton Factory](https://github.com/safe-global/safe-singleton-factory) for same address on all EVM chains.

```bash
# Local testing (deploy factory first)
npm run deploy:factory -- --network localhost

# Deploy LivenessGuard
GUARDIAN_ADDRESS=0x... npm run deploy -- --network <network>

# Optional: custom delay (default 30 days) and salt
GUARDIAN_ADDRESS=0x... RECOVERY_DELAY=604800 SALT=0x02 npm run deploy -- --network <network>
```

Same guardian + delay + salt = same address everywhere.

## License

MIT
