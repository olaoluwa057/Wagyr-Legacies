# Wagyr Legacies Contracts

Production-oriented ERC-721 implementation for Wagyr Legacies NFTs.

## Features

- Three NFT tiers: Genesis Believer, Legacy Backer, and Eternal Patron
- Backend-authorized EIP-712 mint claims
- Per-user nonce replay protection
- Eternal Patron scarcity of 100 slots per player/team
- Signed per-token `ipfs://` metadata URI storage
- Optional ETH claim fee splitting between treasury and buyback wallets
- ERC-2981 royalty signaling
- Role-based administration and emergency pause

## Requirements

Hardhat 3 requires Node.js `22.13.0` or later. The contracts use Solidity
`0.8.28` and OpenZeppelin Contracts v5.

## Install

```sh
nvm use
npm install
```

## Test

```sh
npm test
npm run typecheck
```

If your active shell is still on Node 20, use a Node 22 binary:

```sh
npx -p node@22.13.0 node ./node_modules/hardhat/dist/src/cli.js test
```

## Environment

Copy the example file and fill in testnet values:

```sh
cp .env.example .env
```

Required for Sepolia deployment:

```sh
SEPOLIA_RPC_URL=
SEPOLIA_PRIVATE_KEY=
```

Required for Base Sepolia deployment:

```sh
BASE_SEPOLIA_RPC_URL=
BASE_SEPOLIA_PRIVATE_KEY=
WAGYR_NETWORK=base-sepolia
```

Required for claim generation and minting:

```sh
WAGYR_SIGNER_PRIVATE_KEY=
CLAIMER_PRIVATE_KEY=
WAGYR_CONTRACT_ADDRESS=
```

Required for IPFS pinning through Pinata:

```sh
PINATA_JWT=
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs
```

## Claim Signing Flow

1. Backend validates user backing activity off-chain.
2. Backend creates ERC-721 metadata JSON and pins it to IPFS.
3. Backend signs the exact `ipfs://...` token metadata URI with EIP-712.
4. User calls `claim(request, signature)` and sends the exact configured
   `claimFee()` value. For free mint deployments, this value is `0`.
5. Contract verifies the signer, nonce, expiry, tier threshold, metadata URI,
   Eternal Patron slot, and fee before minting.

The typed data domain is:

```ts
{
  name: "WagyrLegacies",
  version: "1",
  chainId,
  verifyingContract
}
```

The primary type is:

```ts
MintRequest(
  address user,
  uint8 tier,
  uint256 playerId,
  uint256 backedAmount,
  uint256 patronSlot,
  string metadataURI,
  uint256 nonce,
  uint256 expiry
)
```

## Project Docs

- Base Sepolia deployment state: [docs/deployed-testnet-state.md](docs/deployed-testnet-state.md)
- Backend integration spec: [docs/backend-integration.md](docs/backend-integration.md)
- Contract-first deployment plan: [docs/contract-first-deployment-plan.md](docs/contract-first-deployment-plan.md)
- Secret handling and rotation: [docs/secret-handling.md](docs/secret-handling.md)

## IPFS Metadata Pinning

Pinata uploads use the `pinFileToIPFS` endpoint with a JWT bearer token.

Pin an image or media asset:

```sh
npm run pin:ipfs -- --file assets/wagyr-genesis.png --name wagyr-genesis-image
```

Put the returned `ipfs://...` image URI into a metadata JSON file. The metadata
should include `name`, `description`, `image`, `external_url`, and `attributes`.

Pin the metadata JSON:

```sh
npm run pin:ipfs -- --file scripts/metadata.example.json --name wagyr-genesis-metadata
```

Use the returned metadata `ipfsUri` as the `metadataURI` in the signed mint
request.

## Free Minting

Wagyr Legacies supports free NFT minting by setting `claimFee` to `0`. No
contract change is required. Frontends and scripts should still read
`claimFee()` before submitting a claim and send exactly that value; in free mint
mode the transaction value is simply `0` wei.

If a non-zero fee is configured later, the same signed claim flow still works.
The fee is not part of the EIP-712 signed request, so only the transaction value
changes.

## Base Sepolia Deployment

Use the Ignition module with Base Sepolia parameters:

```sh
cp ignition/parameters/base-sepolia.example.json ignition/parameters/base-sepolia.json
npm run deploy:base-sepolia -- --parameters ./ignition/parameters/base-sepolia.json
```

The generated local test setup uses one funded wallet for deployer, admin,
treasury, buyback, royalty receiver, and claimer. It uses a separate signer
wallet for EIP-712 claim authorization.

## Base Mainnet Deployment

Use the Ignition module with production Base parameters:

```sh
cp ignition/parameters/base.example.json ignition/parameters/base.json
npm run deploy:params:check:base
npm run deploy:base -- --parameters ./ignition/parameters/base.json
```

The `deploy:base` script uses the optimized Hardhat `production` build profile.
Set `claimFee` to `"0"` for free minting. The `signer` parameter must match
the production `WAGYR_SIGNER_PRIVATE_KEY` address used by the backend.
Set `WAGYR_SIGNER_ADDRESS` before running the parameter check if you want the
script to verify that match without exposing the private key.

## Ethereum Sepolia Deployment

Use the Ignition module with environment-specific parameters:

```sh
cp ignition/parameters/sepolia.example.json ignition/parameters/sepolia.json
npm run deploy:sepolia -- --parameters ./ignition/parameters/sepolia.json
```

The `signer` parameter in `sepolia.json` must be the address for
`WAGYR_SIGNER_PRIVATE_KEY`.

Production deployment should use multisig-controlled admin, treasury, buyback,
and royalty receiver addresses.

## Generate Signed Claims

All backing amounts are unsigned integer strings using 18 decimals. For example,
`100000000000000000000` means `$100`, and
`1000000000000000000000` means `$1,000`.

Genesis:

```sh
npm run claim:generate -- \
  --contract $WAGYR_CONTRACT_ADDRESS \
  --network base-sepolia \
  --user <claimer-address> \
  --tier 0 \
  --player-id 0 \
  --backed-amount 1 \
  --patron-slot 0 \
  --metadata-uri ipfs://<genesis-metadata-cid> \
  --nonce 1 \
  --expiry 2000000000 \
  --out claims/genesis.json
```

Legacy Backer:

```sh
npm run claim:generate -- \
  --contract $WAGYR_CONTRACT_ADDRESS \
  --network base-sepolia \
  --user <claimer-address> \
  --tier 1 \
  --player-id 0 \
  --backed-amount 100000000000000000000 \
  --patron-slot 0 \
  --metadata-uri ipfs://<legacy-metadata-cid> \
  --nonce 2 \
  --expiry 2000000000 \
  --out claims/legacy.json
```

Eternal Patron:

```sh
npm run claim:generate -- \
  --contract $WAGYR_CONTRACT_ADDRESS \
  --network base-sepolia \
  --user <claimer-address> \
  --tier 2 \
  --player-id 42 \
  --backed-amount 1000000000000000000000 \
  --patron-slot 1 \
  --metadata-uri ipfs://<eternal-patron-metadata-cid> \
  --nonce 3 \
  --expiry 2000000000 \
  --out claims/eternal-patron.json
```

## Mint Signed Claims

`CLAIMER_PRIVATE_KEY` must belong to the same wallet as `request.user` in the
claim file.

```sh
npm run claim:mint -- --network base-sepolia --contract $WAGYR_CONTRACT_ADDRESS --claim-file claims/genesis.json
npm run claim:mint -- --network base-sepolia --contract $WAGYR_CONTRACT_ADDRESS --claim-file claims/legacy.json
npm run claim:mint -- --network base-sepolia --contract $WAGYR_CONTRACT_ADDRESS --claim-file claims/eternal-patron.json
```

The mint script reads `claimFee()` from the deployed contract, sends the exact
value, waits for confirmation, and prints the transaction hash, token ID,
`tokenURI`, `legacyData`, and `patronMintCount`. When `claimFee()` is `0`, this
is a free mint transaction with no ETH value attached beyond gas.
