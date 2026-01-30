import { ethers } from "hardhat";
import { keccak256, concat, getCreate2Address } from "ethers";
import { SAFE_SINGLETON_FACTORY, DEFAULT_SALT, DEFAULT_RECOVERY_DELAY } from "./addresses";

/**
 * Deploy LivenessGuard via CREATE2 for deterministic addresses
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network <network>
 *
 * Environment variables:
 *   GUARDIAN_ADDRESS - The guardian address (required)
 *   RECOVERY_DELAY   - Recovery delay in seconds (optional, default: 30 days)
 *   SALT             - Custom salt (optional, default: 0x...01)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  // Get parameters
  const guardian = process.env.GUARDIAN_ADDRESS;
  if (!guardian) {
    throw new Error("GUARDIAN_ADDRESS environment variable required");
  }

  const recoveryDelay = process.env.RECOVERY_DELAY
    ? BigInt(process.env.RECOVERY_DELAY)
    : DEFAULT_RECOVERY_DELAY;

  const salt = (process.env.SALT || DEFAULT_SALT) as `0x${string}`;

  console.log("=".repeat(60));
  console.log("Deploying LivenessGuard via CREATE2");
  console.log("=".repeat(60));
  console.log("Chain ID:       ", chainId);
  console.log("Deployer:       ", deployer.address);
  console.log("Guardian:       ", guardian);
  console.log("Recovery Delay: ", recoveryDelay.toString(), "seconds");
  console.log("Salt:           ", salt);
  console.log();

  // Check if factory exists
  const factoryCode = await ethers.provider.getCode(SAFE_SINGLETON_FACTORY);
  if (factoryCode === "0x") {
    console.error("❌ SAFE Singleton Factory not found at", SAFE_SINGLETON_FACTORY);
    console.error("   Run: npx hardhat run scripts/deploy-create2-factory.ts --network localhost");
    throw new Error("Factory not deployed");
  }
  console.log("✅ Factory found at:", SAFE_SINGLETON_FACTORY);

  // Get contract bytecode with constructor args
  const factory = await ethers.getContractFactory("LivenessGuard");
  const initCode = concat([
    factory.bytecode,
    factory.interface.encodeDeploy([guardian, recoveryDelay]),
  ]);

  // Calculate expected address
  const expectedAddress = getCreate2Address(
    SAFE_SINGLETON_FACTORY,
    salt,
    keccak256(initCode)
  );
  console.log("Expected address:", expectedAddress);

  // Check if already deployed
  const existingCode = await ethers.provider.getCode(expectedAddress);
  if (existingCode !== "0x") {
    console.log();
    console.log("✅ Already deployed at:", expectedAddress);
    return { address: expectedAddress };
  }

  // Deploy via factory
  console.log();
  console.log("Deploying...");
  const tx = await deployer.sendTransaction({
    to: SAFE_SINGLETON_FACTORY,
    data: concat([salt, initCode]),
  });
  await tx.wait();

  // Verify
  const deployedCode = await ethers.provider.getCode(expectedAddress);
  if (deployedCode === "0x") {
    throw new Error("Deployment failed - no code at expected address");
  }

  console.log("✅ Deployed at:", expectedAddress);
  console.log();
  console.log("=".repeat(60));
  console.log("Deployment complete");
  console.log("=".repeat(60));
  console.log();
  console.log("Contract address:", expectedAddress);
  console.log("Guardian:        ", guardian);
  console.log("Recovery delay:  ", recoveryDelay.toString(), "seconds");
  console.log();
  console.log("This address will be the same on all EVM chains with the same parameters.");

  return { address: expectedAddress };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
