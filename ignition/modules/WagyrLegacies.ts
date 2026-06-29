import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("WagyrLegaciesModule", (m) => {
  const admin = m.getParameter("admin");
  const signer = m.getParameter("signer");
  const treasury = m.getParameter("treasury");
  const buyback = m.getParameter("buyback");
  const royaltyReceiver = m.getParameter("royaltyReceiver");
  const royaltyFeeNumerator = m.getParameter("royaltyFeeNumerator", 250);
  const claimFee = m.getParameter("claimFee", 0n);

  const wagyrLegacies = m.contract("WagyrLegacies", [
    admin,
    signer,
    treasury,
    buyback,
    royaltyReceiver,
    royaltyFeeNumerator,
    claimFee,
  ]);

  return { wagyrLegacies };
});

