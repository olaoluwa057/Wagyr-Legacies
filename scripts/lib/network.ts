import { http } from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";

import { optionalArg, type ParsedArgs } from "./cli.js";

export function getTargetNetwork(args: ParsedArgs) {
  const requested = optionalArg(args, "network") ?? process.env.WAGYR_NETWORK ?? "base-sepolia";

  if (requested === "base-sepolia" || requested === "baseSepolia") {
    return {
      name: "base-sepolia",
      chain: baseSepolia,
      rpcEnvKey: "BASE_SEPOLIA_RPC_URL",
    } as const;
  }

  if (requested === "base" || requested === "base-mainnet") {
    return {
      name: "base",
      chain: base,
      rpcEnvKey: "BASE_RPC_URL",
    } as const;
  }

  if (requested === "sepolia") {
    return {
      name: "sepolia",
      chain: sepolia,
      rpcEnvKey: "SEPOLIA_RPC_URL",
    } as const;
  }

  throw new Error("--network must be base, base-sepolia, or sepolia");
}

export function getTransport(rpcUrl: string) {
  return http(normalizeRpcUrl(rpcUrl));
}

export function assertExpectedChainId(actualChainId: number, expectedChainId: number, networkName: string): void {
  if (actualChainId !== expectedChainId) {
    throw new Error(
      `RPC chain ID ${actualChainId} does not match selected network ${networkName} (${expectedChainId})`,
    );
  }
}

export function normalizeRpcUrl(rpcUrl: string): string {
  if (rpcUrl.startsWith("http://") || rpcUrl.startsWith("https://")) {
    return rpcUrl;
  }

  return `https://${rpcUrl}`;
}
