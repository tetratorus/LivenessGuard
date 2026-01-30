/**
 * SAFE Singleton CREATE2 Factory address (same on all EVM chains)
 * https://github.com/safe-global/safe-singleton-factory
 */
export const SAFE_SINGLETON_FACTORY = "0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7";

/**
 * Default salt for LivenessGuard deployment
 * Change this if you need a different deployment
 */
export const DEFAULT_SALT = "0x0000000000000000000000000000000000000000000000000000000000000001";

/**
 * Default recovery delay (30 days in seconds)
 */
export const DEFAULT_RECOVERY_DELAY = 30n * 24n * 60n * 60n;
