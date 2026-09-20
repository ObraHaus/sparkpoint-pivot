"use client";

/**
 * RouteConfirm (FR-054) — the CLIENT half of the standalone /confirm/[intent] route.
 *
 * Threads the URL amount context (`?assets=` / `?shares=` raw base units + `?vault=`) — the SAME
 * amount the chat inline card carries from a live `proposedAction` — into the SAME `useVaultConfirm`
 * hook, so a deposit/withdraw confirm opened as a full route builds the identical `OnchainConfirm`
 * and renders the IDENTICAL real gate (<ConfirmFlow mount="route" onchain>) that the inline mount +
 * the vault amount screen run. ONE gate, two mount points — never a second copy of the maths.
 *
 * Fail-closed + honest fallbacks (no fabricated amount, never the "ships at launch" stub for a live
 * intent):
 *   • deposit/withdraw WITH a usable amount that clears the live reads ⇒ the real gate.
 *   • deposit/withdraw WITHOUT a usable amount (or not signable yet) ⇒ the LIVE amount-entry screen,
 *     which runs the exact same gate on confirm.
 *   • deposit ALWAYS sits behind the beta whitelist (mirrors /vault/deposit) so the route can't
 *     bypass the BETA gate.
 *
 * ⚠️ This route mounts its OWN `useVaultConfirm` and, when `hasAmount && ready`, renders
 * `<ConfirmFlow>` DIRECTLY — it does not go through `<AmountScreenRoute>`. So it is a genuine second
 * authorization point, not just a shell: any per-vault deposit gate must hold here independently.
 * A 024 review caught exactly that — the `retired` fail-close was threaded into `_amount-screen` but
 * not here, leaving `/confirm/deposit?vault=<retired>` signable. The durable fix was to resolve
 * `retired` centrally inside `useVault` (from the address book, by vault address) so this route and any
 * future mount inherit it; the explicit pass below is belt-and-braces. Keep both.
 *   • swap/premium/bridge (not live) ⇒ the shared honest <ConfirmFlow> placeholder, unchanged.
 */

import { useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { ConfirmFlow, type ConfirmIntent } from "@/components/ui/ConfirmFlow";
import { useVaultConfirm } from "@/lib/chain/useVaultConfirm";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { buildVaultOptions, resolveSelectedVault } from "@/lib/chain/vaultOptions";
import { VAULT_CHAIN_AVAILABLE } from "@/lib/chain/vaultChain";
import { parseConfirmParams } from "@/lib/chain/confirmParams";
import { useBeta } from "@/lib/auth/whitelist";
import { BetaGate } from "@/components/BetaGate";
import { AmountScreenRoute } from "../../vault/_amount-screen";

/** The chain whose address book seeds the vault options pre-connect (Base Sepolia). Mirrors _amount-screen. */
const DISPLAY_CHAIN_ID = APP_DEFAULT_CHAIN_ID;

/** Address book for a chain, or `undefined` on an unsupported chain (getAddresses throws) — fail-closed. */
function safeAddresses(chainId: number | undefined) {
  if (chainId === undefined) return undefined;
  try {
    return getAddresses(chainId);
  } catch {
    return undefined;
  }
}

export function RouteConfirm({ intent }: { intent: ConfirmIntent }) {
  if (intent === "deposit") return <BetaGatedDepositConfirm />;
  if (intent === "withdraw") return <RouteVaultConfirm mode="withdraw" />;
  // swap | premium | bridge — not live; the shared honest placeholder (unchanged behavior).
  return (
    <div className="page">
      <ConfirmFlow intent={intent} mount="route" />
    </div>
  );
}

/** Deposit sits behind the beta whitelist, exactly like /vault/deposit — no route-level bypass. */
function BetaGatedDepositConfirm() {
  const { canTransact } = useBeta();
  if (!canTransact) return <BetaGate />;
  return <RouteVaultConfirm mode="deposit" />;
}

function RouteVaultConfirm({ mode }: { mode: "deposit" | "withdraw" }) {
  const sp = useSearchParams();
  const params = parseConfirmParams(sp);
  const { chainId, isConnected } = useAccount();

  // Resolve the `?vault=` selection exactly as _amount-screen does (default = launch Aave vault).
  const bookChainId = isConnected ? chainId : DISPLAY_CHAIN_ID;
  const book = safeAddresses(bookChainId);
  const options = buildVaultOptions({
    wrappers: book?.sparkPointWrappers,
    includeLaunch: VAULT_CHAIN_AVAILABLE,
  });
  const sel = resolveSelectedVault(options, params.vaultSelected);

  // Redeem-by-shares applies to withdraw only; deposit ignores it.
  const wantShares = mode === "withdraw" ? params.shares : undefined;
  const hasAmount = params.assets !== undefined || wantShares !== undefined;

  // Called UNCONDITIONALLY (Rules of Hooks); useVaultConfirm is safe with a 0/undefined amount.
  const { ready, onchain } = useVaultConfirm({
    mode,
    assets: params.assets,
    shares: wantShares,
    vaultAddress: sel.vaultAddress,
    kind: sel.kind,
    label: sel.label,
    // 024: a retired vault must never be deposit-signable from THIS mount either. `useVault` resolves
    // `retired` from the address book by vault address, so the fail-close holds even without this line
    // — it is passed explicitly as belt-and-braces, matching `_amount-screen`. Withdraw is unaffected (N2).
    retired: sel.retired,
  });

  // THE REAL GATE — byte-identical to the chat inline card + the vault amount screen — as soon as the
  // URL carries a usable amount and the live reads clear. Fail-closed until then.
  if (hasAmount && ready) {
    return (
      <div className="page">
        <ConfirmFlow intent={mode} mount="route" onchain={onchain} />
      </div>
    );
  }
  // No usable amount (or not signable yet) ⇒ the LIVE amount-entry screen, which runs the same real
  // gate on confirm. Honest + non-fabricating — never the "ships at launch" stub for a live intent.
  return <AmountScreenRoute mode={mode} />;
}
