import "dotenv/config";

import { writeFile } from "node:fs/promises";

import { createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  signMintRequest,
  wagyrDomain,
  type MintRequest,
} from "../utils/signature.js";
import {
  ensureParentDir,
  hasHelp,
  optionalArg,
  parseArgs,
  requireAddress,
  requireArg,
  requireEnv,
  requireIpfsUri,
  requirePrivateKey,
  requireTier,
  requireUint,
  stringifyJson,
} from "./lib/cli.js";
import { assertExpectedChainId, getTargetNetwork, getTransport } from "./lib/network.js";

const args = parseArgs();

if (hasHelp(args)) {
  printHelp();
  process.exit(0);
}

try {
  const outPath = requireArg(args, "out");
  const request: MintRequest = {
    user: requireAddress(requireArg(args, "user"), "--user"),
    tier: requireTier(requireArg(args, "tier")),
    playerId: requireUint(requireArg(args, "player-id"), "--player-id"),
    backedAmount: requireUint(requireArg(args, "backed-amount"), "--backed-amount"),
    patronSlot: requireUint(requireArg(args, "patron-slot"), "--patron-slot"),
    metadataURI: requireIpfsUri(requireArg(args, "metadata-uri")),
    nonce: requireUint(requireArg(args, "nonce"), "--nonce"),
    expiry: requireUint(requireArg(args, "expiry"), "--expiry"),
  };

  const now = BigInt(Math.floor(Date.now() / 1000));
  if (request.expiry <= now) {
    throw new Error("--expiry must be a future Unix timestamp in seconds");
  }

  const targetNetwork = getTargetNetwork(args);
  const rpcUrl = requireEnv(targetNetwork.rpcEnvKey);
  const signerPrivateKey = requirePrivateKey(
    requireEnv("WAGYR_SIGNER_PRIVATE_KEY"),
    "WAGYR_SIGNER_PRIVATE_KEY",
  );
  const contractAddress = requireAddress(
    optionalArg(args, "contract") ?? requireEnv("WAGYR_CONTRACT_ADDRESS"),
    "--contract or WAGYR_CONTRACT_ADDRESS",
  );

  const publicClient = createPublicClient({
    chain: targetNetwork.chain,
    transport: getTransport(rpcUrl),
  });
  const chainId = await publicClient.getChainId();
  assertExpectedChainId(chainId, targetNetwork.chain.id, targetNetwork.name);
  const signerAccount = privateKeyToAccount(signerPrivateKey);
  const signer = createWalletClient({
    account: signerAccount,
    chain: targetNetwork.chain,
    transport: getTransport(rpcUrl),
  });

  const signature = await signMintRequest({
    chainId,
    contractAddress,
    request,
    signer,
  });

  const output = {
    contractAddress,
    chainId,
    network: targetNetwork.name,
    domain: wagyrDomain(chainId, contractAddress),
    signer: signerAccount.address,
    request,
    signature,
  };

  await ensureParentDir(outPath);
  await writeFile(outPath, `${stringifyJson(output)}\n`);

  console.log(stringifyJson(output));
  console.error(`Wrote signed claim to ${outPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Run with --help for usage.");
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  npm run claim:generate -- \\
    --contract <deployed contract address> \\
    --user <claimer address> \\
    --tier <0|1|2> \\
    --player-id <uint> \\
    --backed-amount <uint, 18-decimal USD amount> \\
    --patron-slot <uint> \\
    --metadata-uri <ipfs://...> \\
    --nonce <uint> \\
    --expiry <future unix seconds> \\
    --network <base|base-sepolia|sepolia> \\
    --out <path>

Environment:
  BASE_RPC_URL, BASE_SEPOLIA_RPC_URL, or SEPOLIA_RPC_URL
  WAGYR_SIGNER_PRIVATE_KEY
  WAGYR_CONTRACT_ADDRESS   Optional fallback for --contract
  WAGYR_NETWORK            Optional default network, defaults to base-sepolia

Tier examples:
  Genesis:        --tier 0 --player-id 0 --backed-amount 1 --patron-slot 0
  Legacy:         --tier 1 --player-id 0 --backed-amount 100000000000000000000 --patron-slot 0
  Eternal Patron: --tier 2 --player-id 42 --backed-amount 1000000000000000000000 --patron-slot 1`);
}
