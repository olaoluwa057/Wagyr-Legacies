import "dotenv/config";

import { readFile } from "node:fs/promises";

import {
  createPublicClient,
  createWalletClient,
  getAddress,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import type { MintRequest } from "../utils/signature.js";
import {
  hasHelp,
  optionalArg,
  parseArgs,
  requireAddress,
  requireArg,
  requireEnv,
  requirePrivateKey,
  requireUint,
  stringifyJson,
} from "./lib/cli.js";
import { getTargetNetwork, getTransport } from "./lib/network.js";

const wagyrAbi = parseAbi([
  "function claim((address user,uint8 tier,uint256 playerId,uint256 backedAmount,uint256 patronSlot,string metadataURI,uint256 nonce,uint256 expiry) request, bytes signature) payable returns (uint256 tokenId)",
  "function claimFee() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function legacyData(uint256 tokenId) view returns (uint8 tier,uint256 playerId,uint256 backedAmount,uint256 patronSlot,address originalClaimer,uint256 mintTimestamp,bool rebateEligible)",
  "function patronMintCount(uint256 playerId) view returns (uint256)",
  "event LegacyMinted(address indexed user,uint256 indexed tokenId,uint8 tier,uint256 indexed playerId,uint256 backedAmount,uint256 patronSlot,bool rebateEligible)",
]);

type ClaimFile = {
  contractAddress?: Address;
  request: Record<string, unknown>;
  signature: Hex;
};

const args = parseArgs();

if (hasHelp(args)) {
  printHelp();
  process.exit(0);
}

try {
  const claimFilePath = requireArg(args, "claim-file");
  const claimFile = JSON.parse(await readFile(claimFilePath, "utf8")) as ClaimFile;
  const contractAddress = requireAddress(
    optionalArg(args, "contract") ?? claimFile.contractAddress ?? requireEnv("WAGYR_CONTRACT_ADDRESS"),
    "--contract, claim file contractAddress, or WAGYR_CONTRACT_ADDRESS",
  );
  const request = parseMintRequest(claimFile.request);
  const signature = requireSignature(claimFile.signature);

  const targetNetwork = getTargetNetwork(args);
  const rpcUrl = requireEnv(targetNetwork.rpcEnvKey);
  const claimerPrivateKey = requirePrivateKey(requireEnv("CLAIMER_PRIVATE_KEY"), "CLAIMER_PRIVATE_KEY");
  const claimerAccount = privateKeyToAccount(claimerPrivateKey);
  if (getAddress(request.user) !== getAddress(claimerAccount.address)) {
    throw new Error(
      `CLAIMER_PRIVATE_KEY address ${claimerAccount.address} does not match request.user ${request.user}`,
    );
  }

  const publicClient = createPublicClient({
    chain: targetNetwork.chain,
    transport: getTransport(rpcUrl),
  });
  const walletClient = createWalletClient({
    account: claimerAccount,
    chain: targetNetwork.chain,
    transport: getTransport(rpcUrl),
  });

  const chainId = await publicClient.getChainId();
  const fee = await publicClient.readContract({
    address: contractAddress,
    abi: wagyrAbi,
    functionName: "claimFee",
  });

  console.error(`Submitting claim on chain ${chainId} with fee ${fee.toString()} wei...`);

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: wagyrAbi,
    functionName: "claim",
    args: [request, signature],
    value: fee,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`Claim transaction reverted: ${hash}`);
  }

  const events = parseEventLogs({
    abi: wagyrAbi,
    eventName: "LegacyMinted",
    logs: receipt.logs,
  });
  const tokenId = events[0]?.args.tokenId;

  const output: Record<string, unknown> = {
    chainId,
    network: targetNetwork.name,
    contractAddress,
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };

  if (tokenId !== undefined) {
    const tokenURI = await readWithRetry(() =>
      publicClient.readContract({
        address: contractAddress,
        abi: wagyrAbi,
        functionName: "tokenURI",
        args: [tokenId],
      }),
    );
    const legacyData = await readWithRetry(() =>
      publicClient.readContract({
        address: contractAddress,
        abi: wagyrAbi,
        functionName: "legacyData",
        args: [tokenId],
      }),
    );
    const patronMintCount = await readWithRetry(() =>
      publicClient.readContract({
        address: contractAddress,
        abi: wagyrAbi,
        functionName: "patronMintCount",
        args: [request.playerId],
      }),
    );

    output.tokenId = tokenId;
    output.tokenURI = tokenURI;
    output.legacyData = formatLegacyData(legacyData);
    output.patronMintCount = patronMintCount;
  }

  console.log(stringifyJson(output));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Run with --help for usage.");
  process.exit(1);
}

function parseMintRequest(raw: Record<string, unknown>): MintRequest {
  if (raw === null || typeof raw !== "object") {
    throw new Error("claim file request must be an object");
  }

  return {
    user: requireAddress(String(raw.user ?? ""), "request.user"),
    tier: parseTier(raw.tier),
    playerId: requireUint(String(raw.playerId ?? ""), "request.playerId"),
    backedAmount: requireUint(String(raw.backedAmount ?? ""), "request.backedAmount"),
    patronSlot: requireUint(String(raw.patronSlot ?? ""), "request.patronSlot"),
    metadataURI: requireMetadataUri(String(raw.metadataURI ?? "")),
    nonce: requireUint(String(raw.nonce ?? ""), "request.nonce"),
    expiry: requireUint(String(raw.expiry ?? ""), "request.expiry"),
  };
}

function parseTier(raw: unknown): number {
  const tier = Number(raw);
  if (!Number.isSafeInteger(tier) || tier < 0 || tier > 2) {
    throw new Error("request.tier must be 0, 1, or 2");
  }

  return tier;
}

function requireMetadataUri(value: string): string {
  if (!value.startsWith("ipfs://") || value.length <= "ipfs://".length) {
    throw new Error("request.metadataURI must be a non-empty ipfs:// URI");
  }

  return value;
}

function requireSignature(signature: unknown): Hex {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error("claim file signature must be a hex string");
  }

  return signature as Hex;
}

function formatLegacyData(legacyData: readonly unknown[]) {
  return {
    tier: legacyData[0],
    playerId: legacyData[1],
    backedAmount: legacyData[2],
    patronSlot: legacyData[3],
    originalClaimer: legacyData[4],
    mintTimestamp: legacyData[5],
    rebateEligible: legacyData[6],
  };
}

async function readWithRetry<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  throw lastError;
}

function printHelp() {
  console.log(`Usage:
  npm run claim:mint -- --contract <deployed contract address> --claim-file <path> [--network base-sepolia]

Environment:
  BASE_SEPOLIA_RPC_URL or SEPOLIA_RPC_URL
  CLAIMER_PRIVATE_KEY
  WAGYR_CONTRACT_ADDRESS   Optional fallback for --contract
  WAGYR_NETWORK            Optional default network, defaults to base-sepolia

Example:
  npm run claim:mint -- --contract $WAGYR_CONTRACT_ADDRESS --claim-file claims/genesis.json`);
}
