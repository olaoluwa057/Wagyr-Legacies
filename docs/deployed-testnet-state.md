# Wagyr Legacies Deployed Testnet State

Last updated: 2026-06-29

## Network

- Network: Base Sepolia
- Chain ID: `84532`
- Explorer: `https://sepolia.basescan.org`
- Contract: `0xe627F0961D6D80BfB346094Bd400A9dc43e0F67f`
- Contract page: `https://sepolia.basescan.org/address/0xe627F0961D6D80BfB346094Bd400A9dc43e0F67f`
- NFT collection page: `https://sepolia.basescan.org/token/0xe627F0961D6D80BfB346094Bd400A9dc43e0F67f`
- Name: `Wagyr Legacies`
- Symbol: `WAGYR`
- Token standard: ERC-721
- Metadata style: per-token `ipfs://...` URI stored on-chain
- Royalty standard: ERC-2981

## Public Testnet Roles

These are public addresses only. Do not infer production role policy from this testnet setup.

- Test deployer/admin/treasury/buyback/royalty receiver/claimer: `0x2bd55f92E85B11Ac748C2348E8f4F0466d133706`
- Test backend signer: `0xEDea7091392e65be2662221906B378CcC009eB12`
- Claim fee: `0` wei
- Royalty fee numerator: `250` basis points

This deployment is configured for free NFT claiming. Users still pay network
gas, but the contract claim fee is zero.

## Minted Test Tokens

| Token ID | Tier | Owner | Token URI | Transaction |
| --- | --- | --- | --- | --- |
| `1` | Genesis Believer | `0x2bd55f92E85B11Ac748C2348E8f4F0466d133706` | `ipfs://QmepJ7HaS9811QiTJB1SKJSSJarXPntKEBRfJEc3yXDTDC` | `0x1441e7ba83da7e10cf042a2368678ed4cd24767749116b2d4c7aae6d57bfba96` |
| `2` | Legacy Backer | `0x2bd55f92E85B11Ac748C2348E8f4F0466d133706` | `ipfs://Qmf7Fw1qgtecbDRchojXeG6ks9rc5es3CQNeRxJ4RPotuP` | `0x197e16187f30782d8d7fc54d3d1f03be4b81d3a72ac2907ff547df66e943ef03` |
| `3` | Eternal Patron | `0x2bd55f92E85B11Ac748C2348E8f4F0466d133706` | `ipfs://QmYrFtj6LEkXXagzPNjJzhFKNjeeVrkYp46bZtJJgXmZ8e` | `0x05dc1564c9ceb2d2dec2fd1ba41ae9394dbb18103fcfb480de245c8956c8f261` |
| `4` | Genesis Believer demo | `0x2bd55f92E85B11Ac748C2348E8f4F0466d133706` | `ipfs://QmRiq63JaF4zQZjhXduxRga7JZqT9tmqx1CszisbvkoD7c` | `0x19cc5497b2f116163ef074d1cb02a7143293deacf0e84c73aa931f9844077305` |
| `5` | Genesis Believer HTTPS image demo | `0x2bd55f92E85B11Ac748C2348E8f4F0466d133706` | `ipfs://QmYs1VfmfaYNVtM2fU4jsjxS1gz25y3qz4SJ7NjExMU4oi` | `0x0ed84b6f9b6fbc8024431f59be71bbebd70845600aa1fc479c14682005bcb2e1` |

## Current Verified State

- `totalMinted() = 5`
- `usedNonces(0x2bd55f92E85B11Ac748C2348E8f4F0466d133706, 1) = true`
- `usedNonces(0x2bd55f92E85B11Ac748C2348E8f4F0466d133706, 2) = true`
- `usedNonces(0x2bd55f92E85B11Ac748C2348E8f4F0466d133706, 3) = true`
- `usedNonces(0x2bd55f92E85B11Ac748C2348E8f4F0466d133706, 4) = true`
- `usedNonces(0x2bd55f92E85B11Ac748C2348E8f4F0466d133706, 5) = true`
- `patronMintCount(42) = 1`

## Pinned Image Assets

| Purpose | URI | Gateway |
| --- | --- | --- |
| Genesis image | `ipfs://QmSf6X7djG82wPc4LWjLtQ5JjyrHCwtNJfqyFekEoziGEF` | `https://gateway.pinata.cloud/ipfs/QmSf6X7djG82wPc4LWjLtQ5JjyrHCwtNJfqyFekEoziGEF` |
| Legacy Backer image | `ipfs://QmdzgEb4NRB28HSsmRMtYFtwVzazNtdCm8ayx9UoTW3ApK` | `https://gateway.pinata.cloud/ipfs/QmdzgEb4NRB28HSsmRMtYFtwVzazNtdCm8ayx9UoTW3ApK` |
| Eternal Patron image | `ipfs://QmZ83JY2AMk8giTjXXAcrqU4DT9Ljn5Ui4KK4QQVT7wd4T` | `https://gateway.pinata.cloud/ipfs/QmZ83JY2AMk8giTjXXAcrqU4DT9Ljn5Ui4KK4QQVT7wd4T` |

## Notes

- BaseScan testnet NFT image rendering may lag or show a placeholder even when the contract, metadata, and image URL are valid.
- Free minting is supported by keeping `claimFee = 0`; callers should still
  read `claimFee()` and send exactly that value.
- Production metadata should keep `ipfs://` URIs unless a marketplace integration explicitly requires HTTPS gateway URLs.
- This testnet deployment was not contract-verified on BaseScan by request.
