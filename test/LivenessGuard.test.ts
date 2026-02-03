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

  async function signActivation(user: HDNodeWallet, expiry: bigint): Promise<string> {
    const ACTIVATE_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes("Activate(address account,uint256 expiry)"));
    const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256"],
      [ACTIVATE_TYPEHASH, user.address, expiry]
    ));
    return user.signMessage(ethers.getBytes(hash));
  }

  async function activateGuard(delegated: LivenessGuard, user: HDNodeWallet): Promise<void> {
    const expiry = BigInt(await time.latest()) + 3600n; // 1 hour from now
    const sig = await signActivation(user, expiry);
    await delegated.activate(expiry, sig);
  }

  describe("activate", () => {
    it("can activate with valid signature", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      const expiry = BigInt(await time.latest()) + 3600n;
      const sig = await signActivation(user, expiry);

      await expect(delegated.activate(expiry, sig))
        .to.emit(delegated, "Activated");

      expect(await delegated.activatedAt()).to.be.gt(0);
    });

    it("cannot activate after expiry", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      const expiry = BigInt(await time.latest()) + 3600n;
      const sig = await signActivation(user, expiry);

      await time.increase(3601); // Past expiry

      await expect(delegated.activate(expiry, sig))
        .to.be.revertedWithCustomError(delegated, "ActivationExpired");
    });

    it("cannot activate twice", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await activateGuard(delegated, user);

      const expiry = BigInt(await time.latest()) + 3600n;
      const sig = await signActivation(user, expiry);

      await expect(delegated.activate(expiry, sig))
        .to.be.revertedWithCustomError(delegated, "AlreadyActivated");
    });

    it("wrong signer cannot activate", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      const wrongUser = await createUser();
      const expiry = BigInt(await time.latest()) + 3600n;
      const sig = await signActivation(wrongUser, expiry); // Wrong signer

      await expect(delegated.activate(expiry, sig))
        .to.be.revertedWithCustomError(delegated, "InvalidSignature");
    });

    it("anyone can relay activation", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      const expiry = BigInt(await time.latest()) + 3600n;
      const sig = await signActivation(user, expiry);

      // Other account relays the activation
      await expect(delegated.connect(other).activate(expiry, sig))
        .to.emit(delegated, "Activated");
    });
  });

  describe("initiateRecovery", () => {
    it("guardian can initiate recovery after activation", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await expect(delegated.connect(guardian).initiateRecovery())
        .to.emit(delegated, "RecoveryInitiated");

      expect(await delegated.recoveryInitiatedAt()).to.be.gt(0);
    });

    it("cannot initiate recovery before activation", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      await expect(delegated.connect(guardian).initiateRecovery())
        .to.be.revertedWithCustomError(delegated, "NotActivated");
    });

    it("non-guardian cannot initiate recovery", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await expect(delegated.connect(other).initiateRecovery())
        .to.be.revertedWithCustomError(delegated, "NotGuardian");
    });

    it("cannot initiate recovery twice", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();

      await expect(delegated.connect(guardian).initiateRecovery())
        .to.be.revertedWithCustomError(delegated, "RecoveryAlreadyInitiated");
    });
  });

  describe("cancelRecovery", () => {
    it("user can cancel recovery (msg.sender == address(this))", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();
      expect(await delegated.recoveryInitiatedAt()).to.be.gt(0);

      await expect(delegated.connect(user).cancelRecovery())
        .to.emit(delegated, "RecoveryCancelled");

      expect(await delegated.recoveryInitiatedAt()).to.equal(0);
    });

    it("non-user cannot cancel recovery", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();

      await expect(delegated.connect(other).cancelRecovery())
        .to.be.revertedWithCustomError(delegated, "NotSelf");

      await expect(delegated.connect(guardian).cancelRecovery())
        .to.be.revertedWithCustomError(delegated, "NotSelf");
    });

    it("cannot cancel if no recovery initiated", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await expect(delegated.connect(user).cancelRecovery())
        .to.be.revertedWithCustomError(delegated, "RecoveryNotInitiated");
    });
  });

  describe("execute", () => {
    it("execute fails before delay", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();

      await expect(delegated.connect(guardian).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "RecoveryDelayNotPassed");

      await time.increase(RECOVERY_DELAY / 2);
      await expect(delegated.connect(guardian).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "RecoveryDelayNotPassed");
    });

    it("execute works after delay", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

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
      await activateGuard(delegated, user);

      await expect(delegated.connect(guardian).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "RecoveryNotInitiated");
    });

    it("execute fails if not guardian or operator", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await expect(delegated.connect(other).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "NotAuthorized");
    });

    it("can transfer ERC20 tokens", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const token = await MockERC20.deploy();
      await token.mint(user.address, 1000n);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      const transferData = token.interface.encodeFunctionData("transfer", [guardian.address, 500n]);
      await delegated.connect(guardian).execute(await token.getAddress(), 0, transferData);

      expect(await token.balanceOf(guardian.address)).to.equal(500n);
      expect(await token.balanceOf(user.address)).to.equal(500n);
    });

    it("can transfer ERC721 tokens", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      const MockERC721 = await ethers.getContractFactory("MockERC721");
      const nft = await MockERC721.deploy();
      await nft.mint(user.address, 1n);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      const transferData = nft.interface.encodeFunctionData("transferFrom", [user.address, guardian.address, 1n]);
      await delegated.connect(guardian).execute(await nft.getAddress(), 0, transferData);

      expect(await nft.ownerOf(1n)).to.equal(guardian.address);
    });
  });

  describe("operators", () => {
    it("guardian can add operator after recovery delay", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await expect(delegated.connect(guardian).addOperator(other.address))
        .to.emit(delegated, "OperatorAdded")
        .withArgs(other.address);

      expect(await delegated.isOperator(other.address)).to.be.true;
    });

    it("guardian cannot add operator before recovery delay", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();

      await expect(delegated.connect(guardian).addOperator(other.address))
        .to.be.revertedWithCustomError(delegated, "RecoveryDelayNotPassed");
    });

    it("non-guardian cannot add operator", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await expect(delegated.connect(other).addOperator(other.address))
        .to.be.revertedWithCustomError(delegated, "NotGuardian");
    });

    it("operator can call execute after being added", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await delegated.connect(guardian).addOperator(other.address);

      const recipient = Wallet.createRandom().address;
      await expect(delegated.connect(other).execute(recipient, ethers.parseEther("1"), "0x"))
        .to.emit(delegated, "Executed");

      expect(await ethers.provider.getBalance(recipient)).to.equal(ethers.parseEther("1"));
    });

    it("guardian can remove operator", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      await delegated.connect(guardian).initiateRecovery();
      await time.increase(RECOVERY_DELAY + 1);

      await delegated.connect(guardian).addOperator(other.address);
      expect(await delegated.isOperator(other.address)).to.be.true;

      await expect(delegated.connect(guardian).removeOperator(other.address))
        .to.emit(delegated, "OperatorRemoved")
        .withArgs(other.address);

      expect(await delegated.isOperator(other.address)).to.be.false;

      await expect(delegated.connect(other).execute(other.address, 0, "0x"))
        .to.be.revertedWithCustomError(delegated, "NotAuthorized");
    });
  });

  describe("passthrough", () => {
    it("user can set implementation", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      const MockSCW = await ethers.getContractFactory("MockSCW");
      const mockSCW = await MockSCW.deploy();

      await expect(delegated.connect(user).setImplementation(await mockSCW.getAddress()))
        .to.emit(delegated, "ImplementationSet")
        .withArgs(await mockSCW.getAddress());

      expect(await delegated.implementation()).to.equal(await mockSCW.getAddress());
    });

    it("non-user cannot set implementation", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      const MockSCW = await ethers.getContractFactory("MockSCW");
      const mockSCW = await MockSCW.deploy();

      await expect(delegated.connect(other).setImplementation(await mockSCW.getAddress()))
        .to.be.revertedWithCustomError(delegated, "NotSelf");
    });

    it("fallback delegates to implementation", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      const MockSCW = await ethers.getContractFactory("MockSCW");
      const mockSCW = await MockSCW.deploy();

      // User sets implementation
      await delegated.connect(user).setImplementation(await mockSCW.getAddress());

      // Call SCW function through the delegated contract
      const scwInterface = MockSCW.interface;
      const calldata = scwInterface.encodeFunctionData("setSCWValue", [42n]);

      // Anyone can call the passthrough
      await deployer.sendTransaction({ to: user.address, data: calldata });

      // Value is stored in user's EOA storage (via delegatecall)
      const getCalldata = scwInterface.encodeFunctionData("getSCWValue");
      const result = await ethers.provider.call({ to: user.address, data: getCalldata });
      const decoded = scwInterface.decodeFunctionResult("getSCWValue", result);
      expect(decoded[0]).to.equal(42n);
    });

    it("fallback does nothing if no implementation set", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);

      // No implementation set, call should just return
      const MockSCW = await ethers.getContractFactory("MockSCW");
      const calldata = MockSCW.interface.encodeFunctionData("setSCWValue", [42n]);

      // Should not revert
      await deployer.sendTransaction({ to: user.address, data: calldata });
    });

    it("LivenessGuard functions take precedence over passthrough", async () => {
      const user = await createUser();
      const delegated = await setupDelegation(user);
      await activateGuard(delegated, user);

      const MockSCW = await ethers.getContractFactory("MockSCW");
      const mockSCW = await MockSCW.deploy();
      await delegated.connect(user).setImplementation(await mockSCW.getAddress());

      // initiateRecovery should still work (not passthrough)
      await expect(delegated.connect(guardian).initiateRecovery())
        .to.emit(delegated, "RecoveryInitiated");
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
