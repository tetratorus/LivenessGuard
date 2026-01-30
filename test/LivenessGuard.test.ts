import { expect } from "chai";
import { ethers, network } from "hardhat";
import { LivenessGuard } from "../typechain-types";
import { Wallet, HDNodeWallet } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("LivenessGuard", function () {
  let guard: LivenessGuard;
  let deployer: any, guardian: any, other: any;
  const RECOVERY_DELAY = 30 * 24 * 60 * 60; // 30 days

  beforeEach(async () => {
    [deployer, guardian, other] = await ethers.getSigners();
    guard = await ethers.deployContract("LivenessGuard", [guardian.address, RECOVERY_DELAY]);
  });

  async function createUser(): Promise<HDNodeWallet> {
    const wallet = Wallet.createRandom().connect(ethers.provider);
    await deployer.sendTransaction({ to: wallet.address, value: ethers.parseEther("10") });
    return wallet;
  }

  async function setupDelegation(user: HDNodeWallet): Promise<LivenessGuard> {
    // Simulate EIP-7702 delegation by setting contract code on user's EOA
    const code = await ethers.provider.getCode(await guard.getAddress());
    await network.provider.send("hardhat_setCode", [user.address, code]);

    return ethers.getContractAt("LivenessGuard", user.address);
  }

  describe("initiateRecovery", () => {
    it("guardian can initiate recovery", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await expect(delegated.connect(guardian).initiateRecovery())
        .to.emit(delegated, "RecoveryInitiated");

      expect(await delegated.recoveryInitiatedAt()).to.be.gt(0);
    });

    it("non-guardian cannot initiate recovery", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await expect(delegated.connect(other).initiateRecovery())
        .to.be.revertedWithCustomError(delegated, "NotGuardian");
    });

    it("cannot initiate recovery twice", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();

      await expect(delegated.connect(guardian).initiateRecovery())
        .to.be.revertedWithCustomError(delegated, "RecoveryAlreadyInitiated");
    });
  });

  describe("cancelRecovery", () => {
    it("user can cancel recovery (msg.sender == address(this))", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      // Guardian initiates recovery
      await delegated.connect(guardian).initiateRecovery();
      expect(await delegated.recoveryInitiatedAt()).to.be.gt(0);

      // User cancels by calling from their own EOA
      // This simulates the user sending a tx to their own address
      await expect(delegated.connect(user).cancelRecovery())
        .to.emit(delegated, "RecoveryCancelled");

      expect(await delegated.recoveryInitiatedAt()).to.equal(0);
    });

    it("non-user cannot cancel recovery", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();

      // Other account tries to cancel - should fail
      await expect(delegated.connect(other).cancelRecovery())
        .to.be.revertedWithCustomError(delegated, "NotSelf");

      // Guardian tries to cancel - should also fail
      await expect(delegated.connect(guardian).cancelRecovery())
        .to.be.revertedWithCustomError(delegated, "NotSelf");
    });

    it("cannot cancel if no recovery initiated", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await expect(delegated.connect(user).cancelRecovery())
        .to.be.revertedWithCustomError(delegated, "RecoveryNotInitiated");
    });
  });

  describe("execute", () => {
    it("execute fails before delay", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();

      // Try to execute immediately - should fail
      await expect(delegated.connect(guardian).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "RecoveryDelayNotPassed");

      // Try after partial delay - should still fail
      await time.increase(RECOVERY_DELAY / 2);
      await expect(delegated.connect(guardian).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "RecoveryDelayNotPassed");
    });

    it("execute works after delay", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      const recipient = Wallet.createRandom().address;
      const amount = ethers.parseEther("1");

      await expect(delegated.connect(guardian).execute(recipient, amount, "0x"))
        .to.emit(delegated, "Executed")
        .withArgs(recipient, amount, "0x");

      expect(await ethers.provider.getBalance(recipient)).to.equal(amount);
    });

    it("execute fails if not in recovery", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      // No recovery initiated
      await expect(delegated.connect(guardian).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "RecoveryNotInitiated");
    });

    it("execute fails if not guardian or executor", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await expect(delegated.connect(other).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "NotAuthorized");
    });

    it("can transfer ERC20 tokens", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      // Deploy mock token and mint to user
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy();
      await token.mint(user.address, 1000n);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      // Guardian transfers tokens via execute
      const transferData = token.interface.encodeFunctionData("transfer", [guardian.address, 500n]);
      await delegated.connect(guardian).execute(await token.getAddress(), 0, transferData);

      expect(await token.balanceOf(guardian.address)).to.equal(500n);
      expect(await token.balanceOf(user.address)).to.equal(500n);
    });

    it("can transfer ERC721 tokens", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      // Deploy mock NFT and mint to user
      const MockERC721 = await ethers.getContractFactory("MockERC721");
      const nft = await MockERC721.deploy();
      await nft.mint(user.address, 1n);

      expect(await nft.ownerOf(1n)).to.equal(user.address);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      // Guardian transfers NFT via execute
      const transferData = nft.interface.encodeFunctionData("transferFrom", [user.address, guardian.address, 1n]);
      await delegated.connect(guardian).execute(await nft.getAddress(), 0, transferData);

      expect(await nft.ownerOf(1n)).to.equal(guardian.address);
    });
  });

  describe("executors", () => {
    it("guardian can add executor after recovery delay", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await expect(delegated.connect(guardian).addExecutor(other.address))
        .to.emit(delegated, "ExecutorAdded")
        .withArgs(other.address);

      expect(await delegated.isExecutor(other.address)).to.be.true;
    });

    it("guardian cannot add executor before recovery delay", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();

      await expect(delegated.connect(guardian).addExecutor(other.address))
        .to.be.revertedWithCustomError(delegated, "RecoveryDelayNotPassed");
    });

    it("non-guardian cannot add executor", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await expect(delegated.connect(other).addExecutor(other.address))
        .to.be.revertedWithCustomError(delegated, "NotGuardian");
    });

    it("executor can call execute after being added", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await delegated.connect(guardian).addExecutor(other.address);

      const recipient = Wallet.createRandom().address;
      await expect(delegated.connect(other).execute(recipient, ethers.parseEther("1"), "0x"))
        .to.emit(delegated, "Executed");

      expect(await ethers.provider.getBalance(recipient)).to.equal(ethers.parseEther("1"));
    });

    it("guardian can remove executor", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await delegated.connect(guardian).addExecutor(other.address);
      expect(await delegated.isExecutor(other.address)).to.be.true;

      await expect(delegated.connect(guardian).removeExecutor(other.address))
        .to.emit(delegated, "ExecutorRemoved")
        .withArgs(other.address);

      expect(await delegated.isExecutor(other.address)).to.be.false;

      await expect(delegated.connect(other).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "NotAuthorized");
    });
  });

  describe("receive", () => {
    it("accepts ETH transfers", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      const initialBalance = await ethers.provider.getBalance(user.address);
      await deployer.sendTransaction({ to: user.address, value: ethers.parseEther("1") });

      expect(await ethers.provider.getBalance(user.address)).to.equal(
        initialBalance + ethers.parseEther("1")
      );
    });
  });
});
