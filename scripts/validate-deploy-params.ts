import "dotenv/config";

import { readFile } from "node:fs/promises";

import { getAddress, isAddress, type Address } from "viem";

import {
  hasHelp,
  optionalArg,
  parseArgs,
  requireAddress,
  requireUint,
  stringifyJson,
} from "./lib/cli.js";

type IgnitionParameters = {
  WagyrLegaciesModule?: Record<string, unknown>;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const REQUIRED_ADDRESS_FIELDS = [
  "admin",
  "signer",
  "treasury",
  "buyback",
  "royaltyReceiver",
] as const;

const args = parseArgs();

if (hasHelp(args)) {
  printHelp();
  process.exit(0);
}

try {
  const filePath = optionalArg(args, "file") ?? "ignition/parameters/base.json";
  const mainnetMode = args.mainnet === true || args.production === true;
  const raw = JSON.parse(await readFile(filePath, "utf8")) as IgnitionParameters;
  const params = raw.WagyrLegaciesModule;

  if (!params || typeof params !== "object") {
    throw new Error(`${filePath} must contain a WagyrLegaciesModule object`);
  }

  const addresses = Object.fromEntries(
    REQUIRED_ADDRESS_FIELDS.map((field) => [field, requireNonZeroAddress(params[field], field)]),
  ) as Record<(typeof REQUIRED_ADDRESS_FIELDS)[number], Address>;

  const royaltyFeeNumerator = requireSafeBps(params.royaltyFeeNumerator, "royaltyFeeNumerator");
  const claimFee = requireUint(String(params.claimFee ?? "0"), "claimFee");

  if (mainnetMode && claimFee !== 0n) {
    throw new Error("Base mainnet deployment must use claimFee = 0 for free minting");
  }

  const signerAddress = process.env.WAGYR_SIGNER_ADDRESS?.trim();
  if (signerAddress) {
    const expectedSigner = requireAddress(signerAddress, "WAGYR_SIGNER_ADDRESS");
    if (getAddress(addresses.signer) !== getAddress(expectedSigner)) {
      throw new Error(
        `signer parameter ${addresses.signer} does not match WAGYR_SIGNER_ADDRESS ${expectedSigner}`,
      );
    }
  }

  console.log(
    stringifyJson({
      ok: true,
      file: filePath,
      mainnetMode,
      addresses,
      royaltyFeeNumerator,
      claimFee: claimFee.toString(),
      freeMint: claimFee === 0n,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error("Run with --help for usage.");
  process.exit(1);
}

function requireNonZeroAddress(raw: unknown, field: string): Address {
  if (typeof raw !== "string" || !isAddress(raw)) {
    throw new Error(`${field} must be a valid Ethereum address`);
  }

  const address = getAddress(raw);
  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${field} must not be the zero address`);
  }

  return address;
}

function requireSafeBps(raw: unknown, field: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${field} must be an integer between 0 and 10000`);
  }

  return value;
}

function printHelp() {
  console.log(`Usage:
  npm run deploy:params:check -- --file ignition/parameters/base.json --mainnet

Checks:
  - Required WagyrLegaciesModule object exists
  - admin, signer, treasury, buyback, and royaltyReceiver are valid non-zero addresses
  - royaltyFeeNumerator is between 0 and 10000
  - claimFee is an unsigned integer string
  - --mainnet requires claimFee = 0
  - WAGYR_SIGNER_ADDRESS, when set, matches the signer parameter`);
}
