# Liveness Guard

Minimal EIP-7702 dead-man switch for EOA recovery.

## How It Works

1. User delegates their EOA to LivenessGuard via EIP-7702
2. Guardian (fixed at deployment) can initiate recovery
3. Long delay period (e.g., 90 days) where user can veto by calling `cancelRecovery()`
4. After delay, a 7-day recovery window opens
5. Guardian can `execute()` to move assets or `addOperator()` to delegate execution rights
6. If the window expires without action, guardian can re-initiate recovery

## SCW Passthrough

LivenessGuard supports passthrough to an underlying Smart Contract Wallet (Safe, ERC-4337, etc.):

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

// Constants
uint256 constant RECOVERY_WINDOW = 7 days;

// Storage per EOA
uint256 recoveryInitiatedAt;  // 0 = normal, >0 = recovery pending
address implementation;       // Underlying SCW for passthrough
mapping(address => bool) isOperator;

// Functions
cancelRecovery()              // User only (msg.sender == address(this))
initiateRecovery()            // Guardian only, can re-initiate after window expires
execute(to, value, data)      // Guardian or operator, after delay, within window
addOperator(operator)         // Guardian only, after delay, within window
removeOperator(operator)      // Guardian only
setImplementation(impl)       // User only, sets SCW passthrough
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

# Optional: custom delay (default 90 days) and salt
GUARDIAN_ADDRESS=0x... RECOVERY_DELAY=7776000 SALT=0x02 npm run deploy -- --network <network>
```

Same guardian + delay + salt = same address everywhere.

## License

MIT
