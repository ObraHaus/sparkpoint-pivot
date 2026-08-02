"use client";

/**
 * InlineConfirm — the chat thread's inline confirm + sign card.
 *
 * P0.1: the old MOCK inline flow (fake `setTimeout` simulation → fake signature →
 * hardcoded "Deposit confirmed." receipt) is GONE. There is no fake success,
 * signature, or preview anywhere in this file.
 *
 *  • A VAULT action (deposit | withdraw) drives the SAME real execution path as the
 *    Vault amount screen: `useVaultConfirm` builds the live `OnchainConfirm` from
 *    direct-RPC reads (with the amount carried by the live card's `proposedAction`),
 *    and the shared <ConfirmFlow onchain> runs the real quote + on-chain preview
 *    gate and the real approve/deposit / redeem. When the wallet/vault/amount isn't
 *    ready, an HONEST non-signable notice is shown (never a fake preview/success).
 *
 *  • A `bridge` intent renders the shared <ConfirmFlow> placeholder — an honest
 *    "ships at launch" state, non-signable.
 *
 *  • An action type with no in-app execution path at all (`aave_supply`, session-key
 *    ops, …) renders {@link InlineUnsupported} — an inert notice that names the gap.
 *    It used to render the PREMIUM confirm, which read as a paywall on something
 *    that was never paid (025); `InlineIntent` no longer has a `premium` member, so
 *    that mapping is now unrepresentable rather than merely unused.
 */

import { useRouter } from "next/navigation";
import type { TokenRef } from "@sparkpoint/shared/schemas";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { ConfirmFlow } from "@/components/ui/ConfirmFlow";
import { useVaultConfirm } from "@/lib/chain/useVaultConfirm";
import { InlineSwapConfirm } from "@/components/screens/chat/inline-swap-confirm";
import {
  unsupportedActionBody,
  unsupportedActionTitle,
  type UnsupportedActionIntent,
} from "@/lib/chat/actionSupport";
import "@/components/screens/confirm.css";

/**
 * What the chat asks to confirm. Vault intents carry the LIVE amount from the card's
 * `proposedAction` (`assets` in USDC base units, or `shares` for a redeem-by-shares);
 * both may be absent for the offline/mock demo path, in which case the vault confirm
 * shows an honest "connect your wallet" notice rather than a fabricated preview.
 */
export type InlineIntent =
  | { kind: "deposit"; assets?: bigint }
  | { kind: "withdraw"; assets?: bigint; shares?: bigint }
  | {
      kind: "swap";
      ethToUsdc?: boolean;
      amountIn?: bigint;
      slippageBps?: number;
      /** An assistant-proposed pay/receive token pair (007 · US4). Addresses only — the card re-reads
       * `decimals()` on-chain and treats a non-recommended token as unverified by default. */
      tokenIn?: TokenRef;
      tokenOut?: TokenRef;
      /** The network the proposal targets — reconciled against the connected wallet before quoting. */
      chainId?: number;
    }
  | { kind: "bridge" }
  | UnsupportedActionIntent;

export function InlineConfirm({ intent }: { intent: InlineIntent }) {
  if (intent.kind === "deposit" || intent.kind === "withdraw") {
    return <InlineVaultConfirm intent={intent} />;
  }
  if (intent.kind === "unsupported") {
    return <InlineUnsupported actionType={intent.actionType} />;
  }
  if (intent.kind === "swap") {
    // Functional, non-custodial inline swap (Uniswap V3): the user enters an amount, sees a live
    // quote, and signs right here — the same engines as the /swap page.
    return (
      <InlineSwapConfirm
        ethToUsdc={intent.ethToUsdc}
        amountIn={intent.amountIn}
        slippageBps={intent.slippageBps}
        tokenIn={intent.tokenIn}
        tokenOut={intent.tokenOut}
        chainId={intent.chainId}
      />
    );
  }
  // `bridge` — not-yet-live but a real product surface → the shared honest placeholder.
  return <ConfirmFlow intent={intent.kind} mount="inline" />;
}

/**
 * An action type SparkPoint has no in-app execution path for. Deliberately has NO action button:
 * there is nothing to sign, nothing to open, and nothing to buy — offering a CTA would imply one
 * of those exists. The copy lives in `lib/chat/actionSupport` (pure + unit-tested) so the "this
 * isn't a paywall" guarantee is asserted by a test, not by whoever edits this file next.
 */
function InlineUnsupported({ actionType }: { actionType: string }) {
  return (
    <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{unsupportedActionTitle(actionType)}</div>
          <span style={{ color: "var(--muted-foreground)", display: "flex" }}>
            <Icon name="info" size={18} />
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>
          {unsupportedActionBody(actionType)}
        </div>
      </div>
    </div>
  );
}

/** Vault deposit/withdraw inline — the REAL gate when ready, an honest notice otherwise. */
function InlineVaultConfirm({
  intent,
}: {
  intent: { kind: "deposit" | "withdraw"; assets?: bigint; shares?: bigint };
}) {
  const { ready, label, onchain } = useVaultConfirm({
    mode: intent.kind,
    assets: intent.assets,
    shares: intent.kind === "withdraw" ? intent.shares : undefined,
  });

  if (ready) {
    // The REAL path: live quote + on-chain preview gate, then the real signed tx.
    return <ConfirmFlow intent={intent.kind} mount="inline" onchain={onchain} />;
  }
  return <InlineBlocked kind={intent.kind} reason={label} />;
}

/** Honest, non-signable notice when a vault action can't be prepared yet. */
function InlineBlocked({ kind, reason }: { kind: "deposit" | "withdraw"; reason: string }) {
  const router = useRouter();
  const route = kind === "deposit" ? "vault/deposit" : "vault/withdraw";
  const title = kind === "deposit" ? "Confirm: Deposit" : "Confirm: Withdrawal";
  return (
    <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          <Icon name="flask" size={18} />
        </div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>
          {reason} to review the live preview and sign. <b>Nothing moves until you sign.</b>
        </div>
      </div>
      <div className="cf-sec">
        <button className="btn btn-primary btn-md" onClick={() => router.push(toHref(route))}>
          Open the Vault
        </button>
      </div>
    </div>
  );
}
