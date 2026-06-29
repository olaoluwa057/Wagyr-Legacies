# Wagyr Legacies Backend Integration Spec

This document describes how the backend team should integrate with the `WagyrLegacies` NFT contract.

## Integration Goal

The backend is responsible for deciding whether a user qualifies for an NFT, creating/pinning metadata, signing a mint authorization, and preventing duplicate business claims. The smart contract verifies the backend signature, enforces tier thresholds, rejects replayed nonces, enforces Eternal Patron slot scarcity, collects the claim fee, and mints the NFT.

## Contract Context

- Contract name: `WagyrLegacies`
- Current Base Sepolia contract: `0xe627F0961D6D80BfB346094Bd400A9dc43e0F67f`
- Chain ID: `84532`
- EIP-712 name: `WagyrLegacies`
- EIP-712 version: `1`
- Token standard: ERC-721
- Token URI policy: contract stores a signed per-token `ipfs://...` metadata URI
- Backend signer role: address must have `SIGNER_ROLE` on the contract

## Tier Rules

All `backedAmount` values are unsigned integers with 18 decimals.

| Tier | Enum value | Qualification | Contract requirements |
| --- | ---: | --- | --- |
| Genesis Believer | `0` | Any verified backing amount | `backedAmount > 0`, `patronSlot = 0` |
| Legacy Backer | `1` | At least `$100` verified backing | `backedAmount >= 100000000000000000000`, `patronSlot = 0` |
| Eternal Patron | `2` | At least `$1,000` verified backing on one player/team | `playerId != 0`, `backedAmount >= 1000000000000000000000`, `patronSlot = patronMintCount(playerId) + 1`, `patronSlot <= 100` |

Eternal Patron is the only rebate-eligible tier in v1.

## Claim Data Model

The backend signs this exact request shape:

```ts
type MintRequest = {
  user: `0x${string}`;
  tier: 0 | 1 | 2;
  playerId: bigint;
  backedAmount: bigint;
  patronSlot: bigint;
  metadataURI: string;
  nonce: bigint;
  expiry: bigint;
};
```

Field rules:

- `user`: wallet that will call `claim()` and receive the NFT.
- `tier`: `0`, `1`, or `2`.
- `playerId`: `0` for Genesis/Legacy; non-zero player/team ID for Eternal Patron.
- `backedAmount`: verified backing amount using 18 decimals.
- `patronSlot`: `0` for Genesis/Legacy; next available slot for Eternal Patron.
- `metadataURI`: non-empty `ipfs://...` URI for the pinned ERC-721 metadata JSON.
- `nonce`: unique per user and never reused.
- `expiry`: future Unix timestamp in seconds.

## EIP-712 Signing

Domain:

```ts
{
  name: "WagyrLegacies",
  version: "1",
  chainId: 84532,
  verifyingContract: "0xe627F0961D6D80BfB346094Bd400A9dc43e0F67f"
}
```

Types:

```ts
{
  MintRequest: [
    { name: "user", type: "address" },
    { name: "tier", type: "uint8" },
    { name: "playerId", type: "uint256" },
    { name: "backedAmount", type: "uint256" },
    { name: "patronSlot", type: "uint256" },
    { name: "metadataURI", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" }
  ]
}
```

The contract hashes `metadataURI` with `keccak256(bytes(metadataURI))` internally as required by EIP-712 dynamic string handling. Backend libraries such as viem, ethers, or wagmi should handle this automatically when using typed-data signing.

## Recommended API Endpoints

### `GET /v1/legacies/eligibility`

Purpose: show the frontend what the connected wallet can claim.

Query parameters:

- `wallet`: user wallet address
- `playerId`: optional player/team ID when checking Eternal Patron eligibility

Response:

```json
{
  "wallet": "0x...",
  "eligibleTiers": [
    {
      "tier": 0,
      "name": "Genesis Believer",
      "eligible": true,
      "reason": null,
      "backedAmount": "1",
      "playerId": "0",
      "nextPatronSlot": "0"
    }
  ]
}
```

### `POST /v1/legacies/claims`

Purpose: create metadata, pin it, allocate a nonce, sign the claim, and return the signed payload.

Request:

```json
{
  "wallet": "0x...",
  "tier": 2,
  "playerId": "42"
}
```

Response:

```json
{
  "contractAddress": "0xe627F0961D6D80BfB346094Bd400A9dc43e0F67f",
  "chainId": 84532,
  "request": {
    "user": "0x...",
    "tier": 2,
    "playerId": "42",
    "backedAmount": "1000000000000000000000",
    "patronSlot": "1",
    "metadataURI": "ipfs://...",
    "nonce": "123",
    "expiry": "1782749999"
  },
  "signature": "0x..."
}
```

Recommended HTTP status behavior:

- `200`: signed claim returned
- `400`: invalid request shape, invalid wallet, unsupported tier, invalid player ID
- `401`: unauthenticated user session, if auth is required
- `403`: user does not qualify for requested tier
- `409`: claim already issued or Eternal Patron slot changed before signing
- `422`: metadata could not be generated or pinned
- `500`: unexpected server error

### `GET /v1/legacies/claims/:nonce`

Purpose: allow frontend/support tooling to inspect an issued claim.

Response should include claim status:

- `issued`
- `submitted`
- `minted`
- `expired`
- `revoked`

## Backend Claim Flow

1. Authenticate or identify the user wallet.
2. Load verified backing activity from Wagyr data sources.
3. Determine the highest requested eligible tier.
4. For Eternal Patron, read `patronMintCount(playerId)` from chain and calculate `nextPatronSlot = count + 1`.
5. Reject Eternal Patron if `nextPatronSlot > 100`.
6. Build ERC-721 metadata JSON.
7. Pin image/assets to IPFS if not already pinned.
8. Pin metadata JSON to IPFS.
9. Allocate a per-user nonce in the backend database.
10. Set a short, future expiry. Recommended default: 15 to 60 minutes.
11. Sign the EIP-712 `MintRequest`.
12. Persist the issued claim, request payload, metadata URI, signature hash, and status.
13. Return `{ request, signature }` to the frontend.
14. Frontend calls `claim(request, signature)` directly from the user's wallet.
15. Backend/indexer observes `LegacyMinted`, `ClaimUsed`, `Transfer`, and `PatronSlotAssigned` events and marks claim as minted.

## Nonce Policy

The contract only enforces uniqueness of `(user, nonce)`. The backend must manage nonce allocation.

Recommended database table:

```sql
legacies_claim_nonces (
  id uuid primary key,
  wallet_address text not null,
  nonce numeric not null,
  status text not null,
  tier int not null,
  player_id numeric not null,
  token_id numeric,
  metadata_uri text not null,
  request_json jsonb not null,
  signature text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  minted_at timestamptz,
  unique(wallet_address, nonce)
)
```

Nonce allocation options:

- Use a monotonically increasing integer per wallet.
- Or use a globally unique integer sequence.

Do not reuse a nonce after a failed transaction unless the backend has confirmed on-chain that `usedNonces(user, nonce) == false` and the original claim has expired or been revoked.

## Eternal Patron Slot Policy

Eternal Patron slots are scarce per `playerId`.

Before signing:

1. Read `patronMintCount(playerId)` on-chain.
2. Calculate `expectedSlot = patronMintCount + 1`.
3. Compare with any backend reservation table.
4. Reserve the slot briefly while signing.
5. Sign `patronSlot = expectedSlot`.

The contract will reject the claim if another Eternal Patron mint consumes the slot before the user submits. In that case, backend should issue a new claim with the updated slot and a new nonce.

Recommended reservation expiry: 5 to 15 minutes.

## Metadata Requirements

The contract requires `metadataURI` to start with `ipfs://`.

Recommended metadata JSON:

```json
{
  "name": "Wagyr Legacies Eternal Patron #1",
  "description": "An Eternal Patron NFT earned through verified Wagyr backing activity.",
  "image": "ipfs://...",
  "external_url": "https://wagyr.example/legacies/1",
  "attributes": [
    { "trait_type": "Tier", "value": "Eternal Patron" },
    { "trait_type": "Player ID", "value": "42" },
    { "trait_type": "Backed Amount", "value": "1000.00 USD" },
    { "trait_type": "Patron Slot", "value": "1" },
    { "trait_type": "Rebate Eligible", "value": "true" }
  ]
}
```

Keep production image and metadata URIs as `ipfs://...` by default.

## Frontend Claim Submission

The frontend receives `{ request, signature }` and calls:

```ts
claim(request, signature, { value: claimFee })
```

Before submitting, frontend should:

- Check wallet address matches `request.user`.
- Check `Date.now() / 1000 < request.expiry`.
- Read `claimFee()` from contract and pass exact value.
- Show the user the tier and metadata preview.
- On success, display the transaction hash and token ID from `LegacyMinted`.

## Events To Index

The backend/indexer should track:

- `LegacyMinted(address user, uint256 tokenId, Tier tier, uint256 playerId, uint256 backedAmount, uint256 patronSlot, bool rebateEligible)`
- `ClaimUsed(bytes32 claimHash, address user, uint256 nonce)`
- `PatronSlotAssigned(uint256 playerId, uint256 slot, uint256 tokenId)`
- `Transfer(address from, address to, uint256 tokenId)`
- `MetadataURIAssigned(uint256 tokenId, string metadataURI)`

Ownership-sensitive utilities such as rebates must use current `ownerOf(tokenId)` or indexed `Transfer` state, not `originalClaimer`.

## Failure Modes

Common contract reverts:

- `InvalidClaimUser`: connected wallet is not `request.user`.
- `ClaimExpired`: expiry has passed.
- `NonceAlreadyUsed`: `(user, nonce)` was already claimed.
- `InvalidMetadataURI`: metadata URI is not `ipfs://...`.
- `IncorrectClaimFee`: frontend did not send exact `claimFee`.
- `InvalidSignature`: signer is not authorized or request was modified.
- `InvalidBackedAmount`: tier threshold not met.
- `InvalidPatronSlot`: Eternal Patron slot is stale or invalid.
- `InvalidPlayerId`: Eternal Patron claim used `playerId = 0`.

Backend should convert these into user-friendly messages and, when safe, offer to issue a fresh claim.

## Security Requirements

- Store signer private key in KMS/secret manager.
- Never expose signer private key to frontend.
- Never sign claims for unauthenticated or unverified backing activity.
- Use short claim expiries.
- Keep an audit trail of backing evidence used for each claim.
- Use idempotency keys on claim creation.
- Rate-limit claim creation by wallet and user account.
- Monitor signer role changes on-chain.
- Monitor unexpected mints or metadata URIs.

## Local Tooling Reference

Generate a claim:

```sh
npm run claim:generate -- \
  --network base-sepolia \
  --contract 0xe627F0961D6D80BfB346094Bd400A9dc43e0F67f \
  --user <wallet> \
  --tier 0 \
  --player-id 0 \
  --backed-amount 1 \
  --patron-slot 0 \
  --metadata-uri ipfs://... \
  --nonce 100 \
  --expiry 2000000000 \
  --out claims/example.json
```

Mint a claim:

```sh
npm run claim:mint -- \
  --network base-sepolia \
  --contract 0xe627F0961D6D80BfB346094Bd400A9dc43e0F67f \
  --claim-file claims/example.json
```

