import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Boost } from "../typechain";
import { generateClaimSignatures } from "../guard";
import { expireBoost } from "./helpers";
import TestTokenArtifact from "./TestTokenArtifact.json";
import { Contract } from "ethers";

describe("Claiming", function () {
  let owner: SignerWithAddress;
  let guard: SignerWithAddress;
  let claimer1: SignerWithAddress;
  let claimer2: SignerWithAddress;
  let claimer3: SignerWithAddress;
  let claimer4: SignerWithAddress;
  let boostContract: Boost;
  let token: Contract;
  let boostId: number;

  const proposalId = ethers.utils.id("0x1");
  const depositAmount = 100;
  const perAccount = 33;

  beforeEach(async function () {
    [owner, guard, claimer1, claimer2, claimer3, claimer4] =
      await ethers.getSigners();

    // deploy new boost contract
    const Boost = await ethers.getContractFactory("Boost");
    boostContract = await Boost.deploy();
    await boostContract.deployed();

    // deploy new token contract
    const TestToken = await ethers.getContractFactoryFromArtifact(TestTokenArtifact)
    token = await TestToken.deploy("Test Token", "TST");
    await token.deployed();

    await token.connect(owner).mintForSelf(depositAmount);
    await token.connect(owner).approve(boostContract.address, depositAmount);

    const boostTx = await boostContract
      .connect(owner)
      .create(
        proposalId,
        token.address,
        depositAmount,
        perAccount,
        guard.address,
        (await ethers.provider.getBlock("latest")).timestamp + 60
      );
    await boostTx.wait();
    boostId = 1;
  });

  it(`succeeds for single recipient`, async function () {
    const [signature] = await generateClaimSignatures(
      [claimer1.address],
      guard,
      await guard.getChainId(),
      boostId,
      boostContract.address
    );

    await expect(() =>
      expect(
        boostContract
          .connect(claimer1)
          .claim(boostId, claimer1.address, signature)
      ).to.emit(boostContract, "BoostClaimed")
    ).to.changeTokenBalances(
      token,
      [boostContract, claimer1],
      [-perAccount, perAccount]
    );
  });

  it(`succeeds for multiple recipients`, async function () {
    const signatures = await generateClaimSignatures(
      [claimer1.address, claimer2.address],
      guard,
      await guard.getChainId(),
      boostId,
      boostContract.address
    );

    await expect(() =>
      expect(
        boostContract
          .connect(claimer1)
          .claimMulti(boostId, [claimer1.address, claimer2.address], signatures)
      ).to.emit(boostContract, "BoostClaimed")
    ).to.changeTokenBalances(
      token,
      [boostContract, claimer1, claimer2],
      [-(perAccount * 2), perAccount, perAccount]
    );
  });

  it(`reverts if a signature was already used`, async function () {
    const [signature] = await generateClaimSignatures(
      [claimer1.address],
      guard,
      await guard.getChainId(),
      boostId,
      boostContract.address
    );

    await boostContract
      .connect(claimer1)
      .claim(boostId, claimer1.address, signature);

    await expect(
      boostContract
        .connect(claimer1)
        .claim(boostId, claimer1.address, signature)
    ).to.be.revertedWith("RecipientAlreadyClaimed()");
  });

  it(`reverts if a signature is invalid`, async function () {
    const [signature] = await generateClaimSignatures(
      [claimer1.address],
      guard,
      await guard.getChainId(),
      boostId,
      boostContract.address
    );

    await expect(
      boostContract
        .connect(claimer2)
        .claim(boostId, claimer2.address, signature)
    ).to.be.revertedWith("InvalidSignature()");
  });

  it(`reverts if boost is expired`, async function () {
    const [signature] = await generateClaimSignatures(
      [claimer1.address],
      guard,
      await guard.getChainId(),
      boostId,
      boostContract.address
    );

    await expireBoost();

    await expect(
      boostContract
        .connect(claimer1)
        .claim(boostId, claimer1.address, signature)
    ).to.be.revertedWith("BoostExpired()");
  });

  it(`reverts if boost does not exist`, async function () {
    const [signature] = await generateClaimSignatures(
      [claimer1.address],
      guard,
      await guard.getChainId(),
      boostId,
      boostContract.address
    );

    const boostIdNotExists = ethers.utils.id("0x2");

    await expect(
      boostContract
        .connect(claimer1)
        .claim(boostIdNotExists, claimer1.address, signature)
    ).to.be.revertedWith("BoostDoesNotExist()");
  });

  it(`reverts if total claim amount exceeds boost balance`, async function () {
    const signatures = await generateClaimSignatures(
      [claimer1.address, claimer2.address, claimer3.address, claimer4.address],
      guard,
      await guard.getChainId(),
      boostId,
      boostContract.address
    );

    await expect(
      boostContract
        .connect(claimer1)
        .claimMulti(
          boostId,
          [
            claimer1.address,
            claimer2.address,
            claimer3.address,
            claimer4.address,
          ],
          signatures
        )
    ).to.be.revertedWith("InsufficientBoostBalance()");
  });
});
