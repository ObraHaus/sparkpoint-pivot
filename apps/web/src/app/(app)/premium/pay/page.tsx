"use client";

/**
 * /premium/pay — Upgrade to Premium with a REAL SRK payment: approve (only if needed) + a plain
 * `transfer` to the DISCLOSED treasury Safe, then a server-side on-chain verify that grants the
 * tier. Non-custodial by construction — the user is the sole signer, the treasury is disclosed, and
 * SparkPoint never pulls funds (no `transferFrom`, no standing approval to a SparkPoint contract).
 *
 * Live-real: balance = `balanceOf(owner)`, the approve leg appears only when
 * `allowance(owner, treasury) < price`, and the price is the configured value. Honest-degrades to
 * an "unavailable" state (no sign action) when SRK is unset on the active chain.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { type Address, erc20Abi, formatUnits, type Hex } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { shortfallPurpose } from "@/lib/premium/tierStatus";
import { useSelfPremiumStatus } from "@/lib/premium/useSelfPremiumStatus";
import {
  derivePremiumPayState,
  PREMIUM_PRICE_SRK_BASE,
  PREMIUM_PRICE_SRK_WHOLE,
} from "@/lib/chain/premiumPay";
import { SRK_FAUCET_ANCHOR } from "@/lib/chain/srkFaucet";
import { type PremiumPayExec, useExecutePremiumTx } from "@/lib/chain/useExecutePremiumTx";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/premium.css";

const VAULT_CHAIN = 84532;

/** getAddresses throws on an unsupported chain (fail-closed) — swallow to an "unavailable" state. */
function addressBookFor(chainId: number | undefined) {
  if (!chainId) return undefined;
  try {
    return getAddresses(chainId);
  } catch {
    return undefined;
  }
}

type VerifyState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "granted"; expiresAt?: string }
  | { kind: "error"; message: string };

/** Poll the server-side verify — it needs a couple of confirmations, so it may return `pending`. */
async function verifyPayment(txHash: string): Promise<VerifyState> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const r = await fetch("/api/agent/subscription/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-chain-id": String(VAULT_CHAIN),
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ txHash }),
      });
      const data = (await r.json()) as {
        status?: string;
        expiresAt?: string;
        error?: { message?: string };
      };
      if (r.ok && (data.status === "granted" || data.status === "already_granted")) {
        return { kind: "granted", expiresAt: data.expiresAt };
      }
      if (r.ok && data.status === "pending") {
        await new Promise((res) => setTimeout(res, 4000));
        continue;
      }
      return { kind: "error", message: data.error?.message ?? "Could not verify the payment." };
    } catch {
      await new Promise((res) => setTimeout(res, 4000));
    }
  }
  return { kind: "error", message: "Still confirming on-chain — your payment is safe; check back shortly." };
}

export default function Page() {
  const router = useRouter();
  const premium = useSelfPremiumStatus();
  const { address, chainId, isConnected } = useAccount();
  const owner = address as Address | undefined;

  const addrs = addressBookFor(chainId);
  const srk = addrs?.srk as Address | undefined;
  const treasury = addrs?.premiumTreasury as Address | undefined;
  const configured = !!srk && !!treasury;

  const balRead = useReadContract({
    address: srk,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    query: { enabled: isConnected && !!srk && !!owner, refetchInterval: 15_000 },
  });

  // A plain `transfer` needs no allowance, so there is deliberately no allowance read / approve leg.
  const pay = derivePremiumPayState({
    srk,
    treasury,
    balance: balRead.data as bigint | undefined,
  });
  const { balance, low, balanceKnown } = pay;
  const balanceStr = balanceKnown ? Number(formatUnits(balance, 18)).toLocaleString() : "…";

  const [verify, setVerify] = useState<VerifyState>({ kind: "idle" });

  // Kick the server-side verify from the exec's onDone (event-driven — never a setState-in-effect):
  // once the payment receipt lands, POST the tx hash and grant Premium.
  const onPaid = useCallback((txHash: Hex) => {
    setVerify({ kind: "verifying" });
    void verifyPayment(txHash).then(setVerify);
  }, []);

  const exec: PremiumPayExec | undefined =
    configured && owner && srk && treasury && chainId
      ? { chainId, srk, treasury, account: owner, amount: PREMIUM_PRICE_SRK_BASE, onDone: onPaid }
      : undefined;

  const ctrl = useExecutePremiumTx(exec);

  // A signed-in wallet is required to read balance and sign; keep the sign action fail-closed.
  const canSign = configured && isConnected && !!owner && !low && !ctrl.isBusy && verify.kind === "idle";
  const busyLabel =
    ctrl.stage === "pay"
      ? "Confirm the payment…"
      : verify.kind === "verifying"
        ? "Verifying on-chain — granting Premium…"
        : "Review & sign";

  return (
    <div className="page page-narrow">
      <a
        className="qlink"
        style={{ display: "inline-flex", marginBottom: 14, cursor: "pointer" }}
        onClick={() => router.push(toHref("premium"))}
      >
        <Icon name="chevr" size={15} /> Back
      </a>
      <div className="pagehead">
        <div>
          <h1>{premium.active ? "Extend Premium" : "Upgrade to Premium"}</h1>
          <div className="sub">
            {premium.active
              ? `Premium is active${premium.untilLabel ? ` until ${premium.untilLabel}` : ""} — paying again adds a month on top.`
              : "A subscription payment in SRK — not a vault fee. Cancel anytime."}
          </div>
        </div>
      </div>

      {!configured ? (
        <div className="card card-pad">
          <div className="payrow">
            <span className="muted">SRK on this network</span>
            <span>Unavailable — Premium is on Base Sepolia (84532)</span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 10 }}>
            Switch to Base Sepolia to pay in SRK. Every free feature keeps working regardless.
          </div>
        </div>
      ) : verify.kind === "granted" ? (
        <div className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Icon name="check" size={20} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Premium is active 🎉</div>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>
              {verify.expiresAt
                ? `Your Premium runs until ${new Date(verify.expiresAt).toLocaleDateString()}.`
                : "Your Premium is now active."}{" "}
              Deeper analysis and higher limits are unlocked.
            </div>
            <button
              className="btn btn-primary btn-md"
              style={{ marginTop: 14 }}
              onClick={() => router.push(toHref("premium"))}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="card card-pad">
            <div className="payrow">
              <span className="muted">Plan</span>
              <span style={{ fontWeight: 600 }}>Premium · monthly</span>
            </div>
            <div className="payrow">
              <span className="muted">Price</span>
              {/* SRK only — there is no USD oracle for it, so no dollar figure is shown. */}
              <span className="tnum">{Number(PREMIUM_PRICE_SRK_WHOLE).toLocaleString()} SRK</span>
            </div>
            <div className="payrow">
              <span className="muted">Your SRK balance</span>
              <span
                className="tnum"
                style={{ color: low && balanceKnown ? "var(--caution)" : "var(--foreground)" }}
              >
                {isConnected ? `${balanceStr} SRK` : "connect a wallet"}
              </span>
            </div>
            <div className="payrow">
              <span className="muted">Pays to</span>
              <a
                className="mono"
                href={`https://sepolia.basescan.org/address/${treasury}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--primary)", fontSize: 11 }}
                title="The disclosed fee-treasury multisig — verify on Basescan"
              >
                {treasury?.slice(0, 6)}…{treasury?.slice(-4)} ↗
              </a>
            </div>
          </div>

          {ctrl.error && (
            <div
              className="pm-banner"
              style={{ marginTop: 12, background: "var(--loss-subtle)", borderColor: "color-mix(in srgb,var(--loss) 26%,transparent)" }}
            >
              <Icon name="alert" size={16} />
              <span>{ctrl.error}</span>
            </div>
          )}
          {verify.kind === "error" && (
            <div className="pm-banner" style={{ marginTop: 12, background: "var(--caution-subtle)" }}>
              <Icon name="alert" size={16} />
              <span>{verify.message}</span>
            </div>
          )}

          {low && isConnected && balanceKnown ? (
            <>
              <div
                className="pm-banner"
                style={{ marginTop: 16, background: "var(--caution-subtle)", borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)" }}
              >
                <Icon name="alert" size={16} />
                <span>
                  You need <b>{Number(formatUnits(pay.shortfall, 18)).toLocaleString()} more SRK</b>{" "}
                  {shortfallPurpose(premium)}. This never blocks any free feature.
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                {/* The faucet + live balance moved to /premium (026); /srk is now info-only. */}
                <button
                  className="btn btn-outline btn-lg"
                  style={{ flex: 1 }}
                  onClick={() => router.push(`${toHref("premium")}#${SRK_FAUCET_ANCHOR}`)}
                >
                  Get SRK from the faucet
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "14px 0" }}>
                You&apos;ll sign a <b style={{ color: "var(--foreground)" }}>single payment</b> — a plain SRK transfer to
                the disclosed treasury. Non-custodial: you are the sole signer, and it leaves{" "}
                <b style={{ color: "var(--foreground)" }}>no standing approval</b> — we never pull your funds.
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="btn btn-outline btn-lg"
                  style={{ flex: "none" }}
                  onClick={() => router.push(toHref("premium"))}
                  disabled={ctrl.isBusy || verify.kind === "verifying"}
                >
                  Cancel
                </button>
                <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={!canSign} onClick={() => void ctrl.start()}>
                  {busyLabel}
                </button>
              </div>
            </>
          )}
        </>
      )}

      <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
        Premium never gates the vault, deposits, yield, or withdrawals.
      </div>
    </div>
  );
}
