# Secret Handling And Rotation

## Current Local Secret Files

The following files are intentionally ignored by `.gitignore` and must stay local:

- `.env`
- `claims/*.json`
- `ignition/parameters/base-sepolia.json`
- any future deployment parameter files containing real addresses or operational details

Do not commit private keys, JWTs, generated signatures, raw claim files, or production wallet addresses unless explicitly intended as public documentation.

## Pinata Credential Rotation

The Pinata API key, secret, and JWT used during testing were shared in chat. Treat them as exposed.

Before production or any shared staging environment:

1. Revoke the current Pinata scoped key/JWT in the Pinata dashboard.
2. Create a new scoped key with only the permissions required for pinning metadata/assets.
3. Store the new JWT in a secret manager, not in source control.
4. Update local `.env` only for developer testing.
5. Prefer separate Pinata credentials for local, staging, and production.

## Wallet Key Policy

The Base Sepolia keys generated during testing are throwaway testnet keys.

For production:

- Do not use generated testnet keys.
- Use a multisig or secure custody setup for admin, treasury, buyback, and royalty receiver roles.
- Use a dedicated backend signer key for `SIGNER_ROLE`; it should not hold funds.
- Store signer private keys in a backend secret manager or KMS.
- Rotate signer keys through `setSigner(newSigner, true)` followed by `setSigner(oldSigner, false)`.
- Keep `PAUSER_ROLE` with an operational wallet/multisig that can respond quickly.

## Backend Secret Requirements

The backend integration requires access to:

- RPC URL for the target network
- Backend signer private key for EIP-712 signatures
- IPFS pinning credential, if the backend pins metadata
- Database credentials for nonce/claim tracking

The backend should never need:

- Admin private key
- Treasury private key
- Buyback private key
- User private keys

## Logging Rules

Never log:

- private keys
- JWTs or API secrets
- full generated signatures in production logs
- unredacted authorization headers

Safe to log:

- chain ID
- contract address
- user address
- token ID
- player ID
- claim nonce
- claim expiry
- metadata URI
- transaction hash
- recovered signer address

