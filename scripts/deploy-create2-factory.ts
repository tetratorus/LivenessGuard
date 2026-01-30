import { ethers, network } from "hardhat";
import { getSingletonFactoryInfo } from "@safe-global/safe-singleton-factory";
import { SAFE_SINGLETON_FACTORY } from "./addresses";

/**
 * Deploys the SAFE Singleton Factory at 0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7
 *
 * LOCALHOST ONLY - For production networks, the factory is already deployed.
 * https://github.com/safe-global/safe-singleton-factory
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log("=".repeat(60));
  console.log("Deploying SAFE Singleton Factory - LOCALHOST");
  console.log("=".repeat(60));
  console.log("Chain ID:", chainId);
  console.log();

  // Check if factory is already deployed
  const existingCode = await ethers.provider.getCode(SAFE_SINGLETON_FACTORY);
  if (existingCode !== "0x") {
    console.log("✅ Factory already deployed at:", SAFE_SINGLETON_FACTORY);
    return;
  }

  // Get deployment info for this chain
  const factoryInfo = getSingletonFactoryInfo(chainId);
  if (!factoryInfo) {
    throw new Error(`No singleton factory info for chain ID ${chainId}`);
  }

  console.log("Step 1: Funding deployer address");
  console.log("   Deployer:", factoryInfo.signerAddress);

  // Fund the deployer account
  const fundingAmount = BigInt(factoryInfo.gasLimit) * BigInt(factoryInfo.gasPrice);
  const fundTx = await deployer.sendTransaction({
    to: factoryInfo.signerAddress,
    value: fundingAmount,
  });
  await fundTx.wait();
  console.log("   ✅ Funded");

  console.log("Step 2: Broadcasting pre-signed deployment transaction");
  const deployTxHash = await ethers.provider.send("eth_sendRawTransaction", [
    factoryInfo.transaction,
  ]);
  // Wait for transaction to be mined
  let receipt = null;
  while (!receipt) {
    receipt = await ethers.provider.getTransactionReceipt(deployTxHash);
    if (!receipt) await new Promise((r) => setTimeout(r, 100));
  }
  console.log("   ✅ Deployed");

  // Verify
  const deployedCode = await ethers.provider.getCode(SAFE_SINGLETON_FACTORY);
  if (deployedCode !== "0x") {
    console.log();
    console.log("✅ Factory deployed at:", SAFE_SINGLETON_FACTORY);
  } else {
    throw new Error("Factory deployment failed");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
