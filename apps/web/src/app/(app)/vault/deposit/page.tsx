/**
 * /vault/deposit — deposit USDC into the Aave Yield Vault, with a live shares preview.
 * Faithful port of the design's `vault/deposit` screen (screens/vault.js, `amountScreen`).
 */

import { AmountScreen } from "../_amount-screen";

export default function Page() {
  return <AmountScreen mode="deposit" />;
}
