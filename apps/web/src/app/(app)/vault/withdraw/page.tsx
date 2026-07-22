/**
 * /vault/withdraw — withdraw from the Aave Yield Vault (the "withdraw-always" framing:
 * "Withdraw anytime — even if Sparky is offline"), with a live shares preview.
 * Faithful port of the design's `vault/withdraw` screen (screens/vault.js, `amountScreen`).
 */

import { AmountScreenRoute } from "../_amount-screen";

export default function Page() {
  // AmountScreenRoute owns the `?vault=` read + its Suspense boundary (fallback SSRs the launch shell).
  return <AmountScreenRoute mode="withdraw" />;
}
