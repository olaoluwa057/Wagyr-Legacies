import { network } from "hardhat";
import { parseEther } from "viem";

const { viem } = await network.create();
const [deployer, signer, treasury, buyback, royaltyReceiver] =
  await viem.getWalletClients();

const wagyrLegacies = await viem.deployContract("WagyrLegacies", [
  deployer.account.address,
  signer.account.address,
  treasury.account.address,
  buyback.account.address,
  royaltyReceiver.account.address,
  250,
  parseEther("0.01"),
]);

console.log(`WagyrLegacies deployed to ${wagyrLegacies.address}`);
console.log(`Admin: ${deployer.account.address}`);
console.log(`Signer: ${signer.account.address}`);
console.log(`Treasury: ${treasury.account.address}`);
console.log(`Buyback: ${buyback.account.address}`);
console.log(`Royalty receiver: ${royaltyReceiver.account.address}`);

