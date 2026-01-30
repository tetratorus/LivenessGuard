# Liveness Guard

Minimal EIP-7702 dead-man switch for EOA recovery.

## How It Works

1. User delegates their EOA to LivenessGuard via EIP-7702
2. Guardian (fixed at deployment) can initiate recovery
3. Long delay period (e.g., 30 days)
4. User can veto anytime by calling `cancelRecovery()` - proves key possession
5. After delay, guardian can `execute()` to move assets

## Contract

```solidity
// Immutables (set at deployment)
address immutable guardian;
uint256 immutable recoveryDelay;

// Storage: 1 slot per EOA
uint256 recoveryInitiatedAt;  // 0 = normal, >0 = recovery pending

// Functions
cancelRecovery()              // User only (msg.sender == address(this))
initiateRecovery()            // Guardian only
execute(to, value, data)      // Guardian only, after delay
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
