import type { Address, Hex, WalletClient } from "viem";

export const MINT_REQUEST_TYPES = {
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
} as const;

export type MintRequest = {
  user: Address;
  tier: number;
  playerId: bigint;
  backedAmount: bigint;
  patronSlot: bigint;
  metadataURI: string;
  nonce: bigint;
  expiry: bigint;
};

export function wagyrDomain(chainId: number, verifyingContract: Address) {
  return {
    name: "WagyrLegacies",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

export async function signMintRequest(params: {
  chainId: number;
  contractAddress: Address;
  request: MintRequest;
  signer: WalletClient;
}): Promise<Hex> {
  const { chainId, contractAddress, request, signer } = params;

  if (signer.account === undefined) {
    throw new Error("signer wallet client must have an account");
  }

  return signer.signTypedData({
    account: signer.account,
    domain: wagyrDomain(chainId, contractAddress),
    types: MINT_REQUEST_TYPES,
    primaryType: "MintRequest",
    message: request,
  });
}

