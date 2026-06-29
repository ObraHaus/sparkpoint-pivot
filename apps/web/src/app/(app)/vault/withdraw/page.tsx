/**
 * /vault/withdraw — withdraw from the Aave Yield Vault (the "withdraw-always" framing:
 * "Withdraw anytime — even if Sparky is offline"), with a live shares preview.
 * Faithful port of the design's `vault/withdraw` screen (screens/vault.js, `amountScreen`).
 */

import { AmountScreen } from "../_amount-screen";

export default function Page() {
  return <AmountScreen mode="withdraw" />;
}
