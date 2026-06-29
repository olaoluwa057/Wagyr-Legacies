import { http } from "viem";
import { baseSepolia, sepolia } from "viem/chains";

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

  if (requested === "sepolia") {
    return {
      name: "sepolia",
      chain: sepolia,
      rpcEnvKey: "SEPOLIA_RPC_URL",
    } as const;
  }

  throw new Error("--network must be base-sepolia or sepolia");
}

export function getTransport(rpcUrl: string) {
  return http(normalizeRpcUrl(rpcUrl));
}

export function normalizeRpcUrl(rpcUrl: string): string {
  if (rpcUrl.startsWith("http://") || rpcUrl.startsWith("https://")) {
    return rpcUrl;
  }

  return `https://${rpcUrl}`;
}

