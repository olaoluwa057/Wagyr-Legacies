# Contract-First Deployment Plan

This plan deploys the Wagyr Legacies contract before wiring the backend and UI to
mainnet. The backend and UI should treat the deployed contract address as an
input, not as something they create.

## Current Confidence

- Base Sepolia contract flow is working end to end.
- Local Supabase Docker test generated a real signed claim, pinned metadata to
  IPFS, and minted token `6` on Base Sepolia.
- The deployed testnet contract is configured for free minting with
  `claimFee() == 0`.

## Target

- Network: Base mainnet.
- Contract: `WagyrLegacies`.
- Mint fee: `0` wei.
- Token metadata: signed `ipfs://...` metadata URI.
- Claim signer: production backend signer wallet.
- Admin: production multisig or controlled admin wallet.

## Pre-Deployment Inputs

Prepare these values before deployment:

- `BASE_RPC_URL`: Base mainnet RPC URL.
- `BASE_PRIVATE_KEY`: funded deployer wallet private key.
- `admin`: production admin multisig or admin wallet.
- `signer`: address for `WAGYR_SIGNER_PRIVATE_KEY`.
- `treasury`: production treasury wallet.
- `buyback`: production buyback wallet.
- `royaltyReceiver`: production royalty receiver.
- `royaltyFeeNumerator`: royalty bps, for example `250` for 2.5%.
- `claimFee`: `0` for free minting.

The deployer does not have to remain the long-term admin if `admin` is set to
the production admin wallet during deployment.

## Deployment Steps

1. Rotate any credentials that were shared during testnet work.
2. Fill `.env` with `BASE_RPC_URL` and `BASE_PRIVATE_KEY`.
3. Copy `ignition/parameters/base.example.json` to
   `ignition/parameters/base.json`.
4. Fill `base.json` with production addresses and keep it out of public commits.
5. Validate the deployment parameters:

```sh
npm run deploy:params:check:base
```

This fails if any required address is still the zero-address placeholder, if the
mainnet claim fee is non-zero, if royalty BPS is out of range, or if
`WAGYR_SIGNER_ADDRESS` does not match the `signer` parameter.

6. Run the local verification suite:

```sh
nvm use
npm install
npm test
npm run typecheck
```

7. Deploy to Base mainnet:

```sh
npm run deploy:base -- --parameters ./ignition/parameters/base.json
```

The `deploy:base` script selects the optimized Hardhat `production` build
profile.

8. Save the deployed contract address as `WAGYR_CONTRACT_ADDRESS`.

## Immediate Post-Deployment Checks

Run read-only checks before connecting the backend:

- `name()` returns `Wagyr Legacies`.
- `symbol()` returns `WAGYR`.
- `claimFee()` returns `0`.
- `paused()` returns `false`.
- `hasRole(DEFAULT_ADMIN_ROLE, admin)` returns `true`.
- `hasRole(SIGNER_ROLE, signer)` returns `true`.
- `royaltyInfo(sampleTokenId, salePrice)` returns the expected receiver and bps
  after the first mint.

## First Controlled Mainnet Mint

After the contract is deployed, but before opening the UI:

1. Pin one production metadata JSON file to IPFS.
2. Generate a Genesis claim for an internal wallet.
3. Mint from that wallet with exact `claimFee()` value, which should be `0`.
4. Confirm:
   - `ownerOf(tokenId)` is the claimer wallet.
   - `tokenURI(tokenId)` exactly matches the signed `ipfs://...` URI.
   - `legacyData(tokenId)` matches the signed request.
   - The marketplace/explorer can read the metadata.

## Backend And UI Handoff

After the controlled mint succeeds, update the backend/UI environment:

- `WAGYR_CONTRACT_ADDRESS`: deployed Base mainnet address.
- `WAGYR_SIGNER_PRIVATE_KEY`: production signer private key.
- `BASE_RPC_URL`: production Base RPC.
- `PINATA_JWT`: rotated production JWT.
- Frontend chain: Base mainnet.
- Frontend claim value: always read `claimFee()` from the contract.

Then run the same E2E claim flow used on testnet, using a small allowlisted
group before opening the claim page broadly.

## Mainnet Go/No-Go

Go only when all of these are true:

- Contract deployment checks pass.
- Controlled mainnet mint succeeds.
- Backend signs claims for Base mainnet domain `{ chainId: 8453, verifyingContract }`.
- Supabase function is deployed with production secrets.
- Full app build passes.
- Known migration and dependency-audit risks are either fixed or explicitly
  accepted by the team.
