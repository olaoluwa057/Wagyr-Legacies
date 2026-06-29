import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

import { getAddress, isAddress, type Address, type Hex } from "viem";

export type ParsedArgs = Record<string, string | boolean>;

export function parseArgs(argv = process.argv.slice(2)): ParsedArgs {
  const args: ParsedArgs = {};

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const withoutPrefix = token.slice(2);
    const separatorIndex = withoutPrefix.indexOf("=");
    if (separatorIndex !== -1) {
      const key = withoutPrefix.slice(0, separatorIndex);
      const value = withoutPrefix.slice(separatorIndex + 1);
      requireKey(key);
      args[key] = value;
      continue;
    }

    requireKey(withoutPrefix);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[withoutPrefix] = true;
      continue;
    }

    args[withoutPrefix] = next;
    index++;
  }

  return args;
}

export function hasHelp(args: ParsedArgs): boolean {
  return args.help === true || args.h === true;
}

export function requireArg(args: ParsedArgs, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required argument --${key}`);
  }

  return value.trim();
}

export function optionalArg(args: ParsedArgs, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  return value.trim();
}

export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable ${key}`);
  }

  return value.trim();
}

export function requireAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} must be a valid Ethereum address`);
  }

  return getAddress(value);
}

export function requirePrivateKey(value: string, label: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 32-byte hex private key`);
  }

  return normalized as Hex;
}

export function requireUint(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer string`);
  }

  return BigInt(value);
}

export function requireTier(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("--tier must be 0, 1, or 2");
  }

  const tier = Number(value);
  if (!Number.isSafeInteger(tier) || tier < 0 || tier > 2) {
    throw new Error("--tier must be 0 for Genesis, 1 for Legacy, or 2 for Eternal Patron");
  }

  return tier;
}

export function requireIpfsUri(value: string): string {
  if (!value.startsWith("ipfs://") || value.length <= "ipfs://".length) {
    throw new Error("metadata URI must be a non-empty ipfs:// URI");
  }

  return value;
}

export async function ensureParentDir(filePath: string): Promise<void> {
  const parent = dirname(filePath);
  if (parent !== "." && !existsSync(parent)) {
    await mkdir(parent, { recursive: true });
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, innerValue) => (typeof innerValue === "bigint" ? innerValue.toString() : innerValue),
    2,
  );
}

function requireKey(key: string): void {
  if (key.trim() === "") {
    throw new Error("Argument names cannot be empty");
  }
}

