"use client";

/**
 * /vault/deposit — deposit USDC into the Aave Yield Vault, with a live shares preview.
 * Faithful port of the design's `vault/deposit` screen (screens/vault.js, `amountScreen`).
 *
 * BETA GATE (T047): deposit is a TRANSACTING path, so it sits behind the beta whitelist.
 * When the connected wallet can't transact yet (`useBeta().canTransact === false`) we
 * render <BetaGate/> in place of the amount form, so the deposit ConfirmFlow is never
 * reachable for a non-enabled wallet. Default-permissive on testnet / with no allowlist,
 * so the existing design state is unchanged for everyone who could deposit today.
 *
 * This gate is DEPOSIT-ONLY. The sibling /vault/withdraw route, /exit, and /trust are
 * SEPARATE files that import neither `useBeta` nor `BetaGate` — they stay open to
 * everyone, always (non-custody law, N2: withdraw-is-sacred).
 */

import { AmountScreen } from "../_amount-screen";
import { BetaGate } from "@/components/BetaGate";
import { useBeta } from "@/lib/auth/whitelist";

export default function Page() {
  const { canTransact } = useBeta();
  if (!canTransact) return <BetaGate />;
  return <AmountScreen mode="deposit" />;
}
