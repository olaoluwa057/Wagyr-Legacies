import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther, zeroAddress, type Address, type Hex } from "viem";

import {
  signMintRequest,
  wagyrDomain,
  type MintRequest,
} from "../utils/signature.js";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const chainId = await publicClient.getChainId();

const GENESIS = 0;
const LEGACY = 1;
const ETERNAL_PATRON = 2;

const LEGACY_AMOUNT = parseEther("100");
const ETERNAL_AMOUNT = parseEther("1000");
const DEFAULT_EXPIRY = 2_000_000_000n;

type LegacyDataTuple = readonly [
  number,
  bigint,
  bigint,
  bigint,
  Address,
  bigint,
  boolean,
];

type RoyaltyInfoTuple = readonly [Address, bigint];

async function deployFixture(options: { claimFee?: bigint } = {}) {
  const [admin, signer, treasury, buyback, royaltyReceiver, user, other, attacker] =
    await viem.getWalletClients();
  const claimFee = options.claimFee ?? parseEther("0.01");

  const contract = await viem.deployContract("WagyrLegacies", [
    admin.account.address,
    signer.account.address,
    treasury.account.address,
    buyback.account.address,
    royaltyReceiver.account.address,
    250,
    claimFee,
  ]);

  return {
    admin,
    signer,
    treasury,
    buyback,
    royaltyReceiver,
    user,
    other,
    attacker,
    contract,
    claimFee,
  };
}

function baseRequest(user: Address, overrides: Partial<MintRequest> = {}): MintRequest {
  return {
    user,
    tier: ETERNAL_PATRON,
    playerId: 42n,
    backedAmount: ETERNAL_AMOUNT,
    patronSlot: 1n,
    metadataURI: "ipfs://bafybeigenericmetadata/1.json",
    nonce: 1n,
    expiry: DEFAULT_EXPIRY,
    ...overrides,
  };
}

async function signRequest(
  ctx: Awaited<ReturnType<typeof deployFixture>>,
  request: MintRequest,
  signer = ctx.signer,
): Promise<Hex> {
  return signMintRequest({
    chainId,
    contractAddress: ctx.contract.address,
    request,
    signer,
  });
}

async function claim(
  ctx: Awaited<ReturnType<typeof deployFixture>>,
  request: MintRequest,
  signature: Hex,
  options: { account?: typeof ctx.user; value?: bigint } = {},
) {
  const account = options.account ?? ctx.user;
  const value = options.value ?? ctx.claimFee;
  const hash = await ctx.contract.write.claim([request, signature], {
    account: account.account,
    value,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

function assertAddressEqual(actual: Address, expected: Address) {
  assert.equal(actual.toLowerCase(), expected.toLowerCase());
}

function asAddress(value: unknown): Address {
  return value as Address;
}

function asLegacyData(value: unknown): LegacyDataTuple {
  return value as LegacyDataTuple;
}

function asRoyaltyInfo(value: unknown): RoyaltyInfoTuple {
  return value as RoyaltyInfoTuple;
}

describe("WagyrLegacies", async function () {
  it("mints a valid Eternal Patron claim, stores metadata, emits events, and splits fees", async function () {
    const ctx = await deployFixture({ claimFee: 5n });
    const request = baseRequest(ctx.user.account.address);
    const signature = await signRequest(ctx, request);

    const treasuryBefore = await publicClient.getBalance({
      address: ctx.treasury.account.address,
    });
    const buybackBefore = await publicClient.getBalance({
      address: ctx.buyback.account.address,
    });

    const tx = ctx.contract.write.claim([request, signature], {
      account: ctx.user.account,
      value: ctx.claimFee,
    });

    await viem.assertions.emitWithArgs(tx, ctx.contract, "LegacyMinted", [
      ctx.user.account.address,
      1n,
      ETERNAL_PATRON,
      42n,
      ETERNAL_AMOUNT,
      1n,
      true,
    ]);

    assertAddressEqual(
      asAddress(await ctx.contract.read.ownerOf([1n])),
      ctx.user.account.address,
    );
    assert.equal(await ctx.contract.read.tokenURI([1n]), request.metadataURI);
    assert.equal(await ctx.contract.read.patronMintCount([42n]), 1n);
    assert.equal(await ctx.contract.read.remainingPatronSlots([42n]), 99n);
    assert.equal(await ctx.contract.read.usedNonces([ctx.user.account.address, 1n]), true);

    const data = asLegacyData(await ctx.contract.read.legacyData([1n]));
    assert.equal(data[0], ETERNAL_PATRON);
    assert.equal(data[1], 42n);
    assert.equal(data[2], ETERNAL_AMOUNT);
    assert.equal(data[3], 1n);
    assertAddressEqual(data[4], ctx.user.account.address);
    assert.equal(data[6], true);

    assert.equal(
      await publicClient.getBalance({ address: ctx.treasury.account.address }),
      treasuryBefore + 2n,
    );
    assert.equal(
      await publicClient.getBalance({ address: ctx.buyback.account.address }),
      buybackBefore + 3n,
    );
  });

  it("accepts Genesis and Legacy claims with the correct backing thresholds", async function () {
    const ctx = await deployFixture({ claimFee: 0n });

    const genesis = baseRequest(ctx.user.account.address, {
      tier: GENESIS,
      playerId: 0n,
      backedAmount: 1n,
      patronSlot: 0n,
      metadataURI: "ipfs://bafybeigenesis/1.json",
      nonce: 1n,
    });
    await claim(ctx, genesis, await signRequest(ctx, genesis), { value: 0n });

    const legacy = baseRequest(ctx.other.account.address, {
      tier: LEGACY,
      playerId: 0n,
      backedAmount: LEGACY_AMOUNT,
      patronSlot: 0n,
      metadataURI: "ipfs://bafybeilegacy/2.json",
      nonce: 2n,
    });
    await claim(ctx, legacy, await signRequest(ctx, legacy), {
      account: ctx.other,
      value: 0n,
    });

    assertAddressEqual(
      asAddress(await ctx.contract.read.ownerOf([1n])),
      ctx.user.account.address,
    );
    assertAddressEqual(
      asAddress(await ctx.contract.read.ownerOf([2n])),
      ctx.other.account.address,
    );
    assert.equal(asLegacyData(await ctx.contract.read.legacyData([1n]))[6], false);
    assert.equal(asLegacyData(await ctx.contract.read.legacyData([2n]))[6], false);
  });

  it("rejects invalid signatures, tampered requests, removed signers, wrong users, expiry, and nonce replay", async function () {
    const ctx = await deployFixture();
    const request = baseRequest(ctx.user.account.address);

    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([request, await signRequest(ctx, request, ctx.attacker)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidSignature",
    );

    const signature = await signRequest(ctx, request);
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim(
        [{ ...request, metadataURI: "ipfs://bafybeitampered/1.json" }, signature],
        { account: ctx.user.account, value: ctx.claimFee },
      ),
      ctx.contract,
      "InvalidSignature",
    );

    const wrongDomainSignature = await ctx.signer.signTypedData({
      account: ctx.signer.account,
      domain: wagyrDomain(chainId, zeroAddress),
      types: {
        MintRequest: [
          { name: "user", type: "address" },
          { name: "tier", type: "uint8" },
          { name: "playerId", type: "uint256" },
          { name: "backedAmount", type: "uint256" },
          { name: "patronSlot", type: "uint256" },
          { name: "metadataURI", type: "string" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      },
      primaryType: "MintRequest",
      message: request,
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([request, wrongDomainSignature], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidSignature",
    );

    const removeSignerTx = await ctx.contract.write.setSigner([
      ctx.signer.account.address,
      false,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: removeSignerTx });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([request, signature], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidSignature",
    );

    const restoreSignerTx = await ctx.contract.write.setSigner([
      ctx.signer.account.address,
      true,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: restoreSignerTx });

    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([request, signature], {
        account: ctx.other.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidClaimUser",
    );

    const expired = baseRequest(ctx.user.account.address, {
      nonce: 2n,
      expiry: 1n,
      metadataURI: "ipfs://bafybeiexpired/2.json",
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([expired, await signRequest(ctx, expired)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "ClaimExpired",
    );

    await claim(ctx, request, signature);
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([request, signature], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "NonceAlreadyUsed",
    );
  });

  it("enforces IPFS metadata URI rules", async function () {
    const ctx = await deployFixture();

    const emptyUri = baseRequest(ctx.user.account.address, {
      metadataURI: "",
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([emptyUri, await signRequest(ctx, emptyUri)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidMetadataURI",
    );

    const httpUri = baseRequest(ctx.user.account.address, {
      metadataURI: "https://gateway.example/ipfs/bafybeibad/1.json",
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([httpUri, await signRequest(ctx, httpUri)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidMetadataURI",
    );

    await viem.assertions.revertWithCustomError(
      ctx.contract.read.tokenURI([99n]),
      ctx.contract,
      "ERC721NonexistentToken",
    );
  });

  it("enforces tier thresholds and patron slot requirements", async function () {
    const ctx = await deployFixture();

    const zeroGenesis = baseRequest(ctx.user.account.address, {
      tier: GENESIS,
      playerId: 0n,
      backedAmount: 0n,
      patronSlot: 0n,
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([zeroGenesis, await signRequest(ctx, zeroGenesis)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidBackedAmount",
    );

    const lowLegacy = baseRequest(ctx.user.account.address, {
      tier: LEGACY,
      playerId: 0n,
      backedAmount: LEGACY_AMOUNT - 1n,
      patronSlot: 0n,
      nonce: 2n,
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([lowLegacy, await signRequest(ctx, lowLegacy)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidBackedAmount",
    );

    const zeroPlayer = baseRequest(ctx.user.account.address, {
      playerId: 0n,
      nonce: 3n,
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([zeroPlayer, await signRequest(ctx, zeroPlayer)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidPlayerId",
    );

    const wrongSlot = baseRequest(ctx.user.account.address, {
      patronSlot: 2n,
      nonce: 4n,
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([wrongSlot, await signRequest(ctx, wrongSlot)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidPatronSlot",
    );

    const lowPatron = baseRequest(ctx.user.account.address, {
      backedAmount: ETERNAL_AMOUNT - 1n,
      nonce: 5n,
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([lowPatron, await signRequest(ctx, lowPatron)], {
        account: ctx.user.account,
        value: ctx.claimFee,
      }),
      ctx.contract,
      "InvalidBackedAmount",
    );
  });

  it("enforces the Eternal Patron cap independently per player", async function () {
    const ctx = await deployFixture({ claimFee: 0n });

    for (let slot = 1n; slot <= 100n; slot++) {
      const request = baseRequest(ctx.user.account.address, {
        playerId: 7n,
        patronSlot: slot,
        nonce: slot,
        metadataURI: `ipfs://bafybeiplayerseven/${slot}.json`,
      });
      await claim(ctx, request, await signRequest(ctx, request), { value: 0n });
    }

    assert.equal(await ctx.contract.read.patronMintCount([7n]), 100n);
    assert.equal(await ctx.contract.read.remainingPatronSlots([7n]), 0n);

    const capped = baseRequest(ctx.user.account.address, {
      playerId: 7n,
      patronSlot: 101n,
      nonce: 101n,
      metadataURI: "ipfs://bafybeiplayerseven/101.json",
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([capped, await signRequest(ctx, capped)], {
        account: ctx.user.account,
        value: 0n,
      }),
      ctx.contract,
      "InvalidPatronSlot",
    );

    const otherPlayer = baseRequest(ctx.user.account.address, {
      playerId: 8n,
      patronSlot: 1n,
      nonce: 102n,
      metadataURI: "ipfs://bafybeiplayereight/1.json",
    });
    await claim(ctx, otherPlayer, await signRequest(ctx, otherPlayer), {
      value: 0n,
    });
    assert.equal(await ctx.contract.read.patronMintCount([8n]), 1n);
  });

  it("requires exact fees, supports zero-fee claims, and reverts failed fee transfers", async function () {
    const exactFeeCtx = await deployFixture({ claimFee: 5n });
    const request = baseRequest(exactFeeCtx.user.account.address);
    await viem.assertions.revertWithCustomError(
      exactFeeCtx.contract.write.claim([request, await signRequest(exactFeeCtx, request)], {
        account: exactFeeCtx.user.account,
        value: 4n,
      }),
      exactFeeCtx.contract,
      "IncorrectClaimFee",
    );

    const zeroFeeCtx = await deployFixture({ claimFee: 0n });
    const zeroFeeRequest = baseRequest(zeroFeeCtx.user.account.address);
    await claim(zeroFeeCtx, zeroFeeRequest, await signRequest(zeroFeeCtx, zeroFeeRequest), {
      value: 0n,
    });
    assertAddressEqual(
      asAddress(await zeroFeeCtx.contract.read.ownerOf([1n])),
      zeroFeeCtx.user.account.address,
    );

    const failingCtx = await deployFixture({ claimFee: 5n });
    const revertingReceiver = await viem.deployContract("RevertingReceiver");
    const setRecipientsHash = await failingCtx.contract.write.setFeeRecipients([
      revertingReceiver.address,
      failingCtx.buyback.account.address,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: setRecipientsHash });

    const failingRequest = baseRequest(failingCtx.user.account.address);
    await viem.assertions.revertWithCustomError(
      failingCtx.contract.write.claim([
        failingRequest,
        await signRequest(failingCtx, failingRequest),
      ], {
        account: failingCtx.user.account,
        value: 5n,
      }),
      failingCtx.contract,
      "FeeTransferFailed",
    );
  });

  it("enforces admin roles and pause behavior for claims and transfers", async function () {
    const ctx = await deployFixture({ claimFee: 0n });
    const adminRole = await ctx.contract.read.ADMIN_ROLE();

    await viem.assertions.revertWithCustomErrorWithArgs(
      ctx.contract.write.setClaimFee([1n], { account: ctx.user.account }),
      ctx.contract,
      "AccessControlUnauthorizedAccount",
      [ctx.user.account.address, adminRole],
    );

    const pauseHash = await ctx.contract.write.pause();
    await publicClient.waitForTransactionReceipt({ hash: pauseHash });

    const request = baseRequest(ctx.user.account.address);
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.claim([request, await signRequest(ctx, request)], {
        account: ctx.user.account,
        value: 0n,
      }),
      ctx.contract,
      "EnforcedPause",
    );

    const unpauseHash = await ctx.contract.write.unpause();
    await publicClient.waitForTransactionReceipt({ hash: unpauseHash });
    await claim(ctx, request, await signRequest(ctx, request), { value: 0n });

    await publicClient.waitForTransactionReceipt({
      hash: await ctx.contract.write.pause(),
    });
    await viem.assertions.revertWithCustomError(
      ctx.contract.write.transferFrom(
        [ctx.user.account.address, ctx.other.account.address, 1n],
        { account: ctx.user.account },
      ),
      ctx.contract,
      "EnforcedPause",
    );

    await publicClient.waitForTransactionReceipt({
      hash: await ctx.contract.write.unpause(),
    });
    await publicClient.waitForTransactionReceipt({
      hash: await ctx.contract.write.transferFrom(
        [ctx.user.account.address, ctx.other.account.address, 1n],
        { account: ctx.user.account },
      ),
    });
    assertAddressEqual(
      asAddress(await ctx.contract.read.ownerOf([1n])),
      ctx.other.account.address,
    );
    assert.equal(asLegacyData(await ctx.contract.read.legacyData([1n]))[6], true);
  });

  it("keeps stored data and metadata stable after transfer", async function () {
    const ctx = await deployFixture({ claimFee: 0n });
    const request = baseRequest(ctx.user.account.address);

    await claim(ctx, request, await signRequest(ctx, request), { value: 0n });
    const beforeTransfer = asLegacyData(await ctx.contract.read.legacyData([1n]));

    await publicClient.waitForTransactionReceipt({
      hash: await ctx.contract.write.transferFrom(
        [ctx.user.account.address, ctx.other.account.address, 1n],
        { account: ctx.user.account },
      ),
    });

    const afterTransfer = asLegacyData(await ctx.contract.read.legacyData([1n]));
    assert.deepEqual(afterTransfer, beforeTransfer);
    assertAddressEqual(
      asAddress(await ctx.contract.read.ownerOf([1n])),
      ctx.other.account.address,
    );
    assert.equal(await ctx.contract.read.tokenURI([1n]), request.metadataURI);
  });

  it("supports ERC-721, ERC-4906, ERC-2981 royalties, and AccessControl interfaces", async function () {
    const ctx = await deployFixture({ claimFee: 0n });
    const request = baseRequest(ctx.user.account.address);
    await claim(ctx, request, await signRequest(ctx, request), { value: 0n });

    assert.equal(await ctx.contract.read.supportsInterface(["0x80ac58cd"]), true);
    assert.equal(await ctx.contract.read.supportsInterface(["0x49064906"]), true);
    assert.equal(await ctx.contract.read.supportsInterface(["0x2a55205a"]), true);
    assert.equal(await ctx.contract.read.supportsInterface(["0x7965db0b"]), true);

    const [receiver, royaltyAmount] = asRoyaltyInfo(
      await ctx.contract.read.royaltyInfo([1n, 10_000n]),
    );
    assertAddressEqual(receiver, ctx.royaltyReceiver.account.address);
    assert.equal(royaltyAmount, 250n);
  });
});
