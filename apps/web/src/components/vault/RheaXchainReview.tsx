"use client";

/**
 * 079 — dual-access review UI for the 071 cross-chain Rhea (MCA/1Click) rail.
 *
 * This is NOT 078's same-chain NEAR→Burrow flow. Here the origin is an EVM chain (Base/Ethereum
 * USDC) and 1Click delivers into the user's Rhea Multichain Account on NEAR.
 *
 * NON-CUSTODY: the agent never signs. `dry=true` is the default and moves no funds. A live
 * (`dry=false`) commit is only offered when the server says the flag is on AND the 1Click key is
 * present; even then it returns an UNSIGNED origin ERC-20 transfer plan. The connected wallet is
 * the only signer, and only after an explicit acknowledgement.
 */

import { useEffect, useMemo, useState } from "react";
import { useAccount, useSendTransaction, useSignMessage } from "wagmi";
import { EarnQuoteBlockSchema, type EarnQuoteBlock } from "@sparkpoint/shared/schemas";

import { useAgentClient } from "@/lib/agent/useAgent";
import type { WagmiChainId } from "@/lib/wagmi";
import {
  gateAllowsLive,
  originLabel,
  planIsOfferable,
  transferPlanLine,
  xchainReviewLines,
  type XchainGate,
} from "@/lib/earn/xchain";

interface VaultRow {
  address: string;
  symbol?: string;
}

interface WithdrawPath {
  id: string;
  label: string;
  status: string;
  url: string | null;
  note: string;
  source: string;
}

interface WithdrawReview {
  state: string;
  nep413IsTransaction: boolean;
  custodian: string | null;
  note: string;
  paths: WithdrawPath[];
  sources: { id: string; url: string }[];
}

const MUTED = "var(--muted-foreground)";

function Row({ label, value, tone }: { label: string; value: string; tone?: "caution" | "gain" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span
        style={{
          color:
            tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--foreground)",
          fontWeight: 500,
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Card({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <section
      data-testid={testId}
      className="card card-pad"
      style={{ marginBottom: 16, display: "grid", gap: 10 }}
    >
      {children}
    </section>
  );
}

export function RheaXchainReview({
  initialOrigin,
  initialAmount,
  initialVault,
}: {
  initialOrigin?: string;
  initialAmount?: string;
  initialVault?: string;
}) {
  const { client, online } = useAgentClient();
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { sendTransactionAsync } = useSendTransaction();

  const [gate, setGate] = useState<XchainGate | null>(null);
  const [withdraw, setWithdraw] = useState<WithdrawReview | null>(null);
  const [origin, setOrigin] = useState(initialOrigin || "base:USDC");
  const [amount, setAmount] = useState(initialAmount || "100");
  const [vaultAddress, setVaultAddress] = useState(initialVault || "");
  const [block, setBlock] = useState<EarnQuoteBlock | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const liveAllowed = gateAllowsLive(gate);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void (async () => {
      try {
        const [gateBody, withdrawBody] = await Promise.all([
          client.request<XchainGate>("/earn/rhea/xchain"),
          client.request<WithdrawReview>("/earn/rhea/xchain/withdraw"),
        ]);
        if (cancelled) return;
        setGate(gateBody);
        setWithdraw(withdrawBody);
        if (!initialVault) {
          const vaults = await client.request<{ vaults?: VaultRow[] }>(
            "/earn/vaults?chain=near&protocol=rhea&asset=USDC&limit=5",
          );
          const first = vaults.vaults?.[0];
          if (!cancelled && first) setVaultAddress(first.address);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, initialVault]);

  async function quote(dry: boolean, personalSignature?: string | null) {
    if (!client) return;
    if (!vaultAddress) {
      setError("No Rhea USDC vault is available in the registry yet.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const raw = await client.request<unknown>("/earn/rhea/xchain/quote", {
        method: "POST",
        body: {
          chain: "near",
          vaultAddress,
          originKey: origin,
          amount,
          dry,
          ...(personalSignature ? { signature: personalSignature } : {}),
        },
      });
      const parsed = EarnQuoteBlockSchema.safeParse(raw);
      if (!parsed.success) {
        setError("The cross-chain review response couldn't be verified.");
        return;
      }
      setBlock(parsed.data);
      if (parsed.data.state === "unavailable") {
        setError(parsed.data.unavailableReason ?? "The quote is unavailable.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function signAndCommit() {
    if (!block?.messageToSign) return;
    setBusy(true);
    setError(null);
    try {
      // OFF-CHAIN personal_sign only (never a transaction). The agent still never signs.
      const signed = await signMessageAsync({ message: block.messageToSign });
      setSignature(signed);
      await quote(false, signed);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(
        /rejected|denied|cancel/i.test(raw)
          ? "You cancelled the wallet signature. Nothing was signed or sent."
          : raw,
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmTransfer() {
    const plan = block?.transferPlan;
    if (!block?.live || !planIsOfferable(plan) || !plan || !acknowledged) return;
    setBusy(true);
    setError(null);
    try {
      // The CONNECTED WALLET is the only signer. The agent never signs or submits.
      const hash = await sendTransactionAsync({
        to: plan.tokenAddress as `0x${string}`,
        data: plan.calldata as `0x${string}`,
        value: 0n,
        chainId: (plan.chainId ?? undefined) as WagmiChainId | undefined,
      });
      setTxHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function checkStatus() {
    if (!client || !block?.depositAddress) return;
    setBusy(true);
    try {
      const body = await client.request<{ status?: { status?: string } }>(
        `/earn/rhea/xchain/status?depositAddress=${encodeURIComponent(block.depositAddress)}`,
      );
      setStatus(body.status?.status ?? "unknown");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const lines = useMemo(() => (block ? xchainReviewLines(block, address) : []), [address, block]);
  const plan = block?.transferPlan;

  return (
    <div className="page page-wide" data-testid="rhea-xchain-review">
      <div className="pagehead">
        <div>
          <h1>Rhea cross-chain deposit</h1>
          <div className="sub">
            071 cross-chain MCA rail · EVM USDC → Rhea (Burrow) on NEAR via 1Click · dry by default
          </div>
        </div>
      </div>

      <Card testId="rhea-xchain-gate">
        <div style={{ fontSize: 13, fontWeight: 600 }}>Server gate</div>
        <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
          {gate
            ? `server flag ${gate.serverEnabled ? "on" : "off"} · 1Click key ${
                gate.keyPresent ? "present" : "absent"
              } · live commit ${liveAllowed ? "available" : "disabled"}`
            : "Reading the non-custodial gate…"}
        </div>
        {gate?.reason && (
          <div data-testid="rhea-xchain-gate-reason" style={{ fontSize: 12, color: "var(--caution)" }}>
            {gate.reason}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
          {gate?.note ??
            "The agent prepares data only. It never signs, submits or broadcasts; your wallet is the only signer."}
        </div>
      </Card>

      <Card testId="rhea-xchain-form">
        <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
          <label htmlFor="xchain-origin" style={{ fontSize: 12.5, fontWeight: 600 }}>
            Origin chain / asset
          </label>
          <select
            id="xchain-origin"
            data-testid="rhea-xchain-origin"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            style={{ padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)" }}
          >
            {(gate?.origins?.length ? gate.origins : ["base:USDC", "eth:USDC"]).map((key) => (
              <option key={key} value={key}>
                {originLabel(key)}
              </option>
            ))}
          </select>
          <label htmlFor="xchain-amount" style={{ fontSize: 12.5, fontWeight: 600 }}>
            Amount (USDC)
          </label>
          <input
            id="xchain-amount"
            data-testid="rhea-xchain-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            style={{ padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--card)" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              data-testid="rhea-xchain-dry"
              disabled={!online || busy}
              onClick={() => void quote(true)}
            >
              {busy ? "Reviewing…" : "Dry review (dry=true)"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="rhea-xchain-live"
              disabled={!online || busy || !liveAllowed}
              title={!liveAllowed ? "Live commit needs the server flag and a configured 1Click key." : undefined}
              onClick={() => void quote(false)}
            >
              Prepare live commit (dry=false)
            </button>
          </div>
          {!online && (
            <div style={{ fontSize: 12, color: "var(--caution)" }}>
              Connect a wallet to scope the review to you. Nothing is signed by connecting.
            </div>
          )}
          <div style={{ fontSize: 11.5, color: MUTED }}>
            Connected wallet: {address ?? "not connected"}
            {chainId ? ` · chain ${chainId}` : ""}
          </div>
        </div>
      </Card>

      {error && (
        <Card testId="rhea-xchain-error">
          <div style={{ fontSize: 13, color: "var(--caution)", lineHeight: 1.55 }}>{error}</div>
        </Card>
      )}

      {block && (
        <Card testId="rhea-xchain-block">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {block.live ? "Live review — unsigned plan ready" : "Dry review"}
            </div>
            <span style={{ fontSize: 11.5, color: MUTED }}>
              {block.state === "unavailable" ? "Unavailable" : block.live ? "live quote" : "not signable"}
            </span>
          </div>
          <div style={{ display: "grid", gap: 5, fontSize: 12.5 }}>
            {lines.map((line) => (
              <Row key={line.key} label={line.label} value={line.value} tone={line.tone} />
            ))}
            {block.supplyApy && <Row label="Supply APY (variable)" value={block.supplyApy} />}
            {block.amountOut && <Row label="Estimated supplied" value={`${block.amountOut} USDC`} />}
          </div>

          {block.customRecipientMsg && (
            <details data-testid="rhea-xchain-message">
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                Rhea recipient message (customRecipientMsg)
              </summary>
              <pre
                style={{
                  margin: "8px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11.5,
                }}
              >
                {block.customRecipientMsg}
              </pre>
            </details>
          )}

          {block.requiresSignature && block.messageToSign && (
            <div data-testid="rhea-xchain-signature-required" style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                First deposit: sign this off-chain EVM message
              </div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11.5,
                }}
              >
                {block.messageToSign}
              </pre>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                data-testid="rhea-xchain-sign"
                disabled={busy}
                onClick={() => void signAndCommit()}
                style={{ justifySelf: "start" }}
              >
                {busy ? "Waiting for your wallet…" : "Sign message (personal_sign, off-chain)"}
              </button>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                This is off-chain authentication, not a transaction. The agent still never signs or
                sends; the live quote only starts after your wallet returns the signature.
              </div>
            </div>
          )}

          {block.live && (
            <div data-testid="rhea-xchain-live-plan" style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Unsigned origin transfer</div>
              <div style={{ fontSize: 12.5, color: MUTED, wordBreak: "break-all" }}>
                {transferPlanLine(plan)}
              </div>
              {plan?.calldata && (
                <pre
                  data-testid="rhea-xchain-calldata"
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 11,
                  }}
                >
                  to {plan.tokenAddress}
                  {"\n"}
                  data {plan.calldata}
                </pre>
              )}
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12 }}>
                <input
                  type="checkbox"
                  data-testid="rhea-xchain-ack"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  I reviewed the origin chain, amount, refund address, Rhea recipient message and
                  fees. The transfer is unsigned until my wallet confirms it.
                </span>
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  data-testid="rhea-xchain-confirm"
                  disabled={busy || !acknowledged || !planIsOfferable(plan)}
                  onClick={() => void confirmTransfer()}
                >
                  Confirm transfer in my wallet
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  data-testid="rhea-xchain-status-button"
                  disabled={busy || !block.depositAddress}
                  onClick={() => void checkStatus()}
                >
                  Check 1Click status
                </button>
              </div>
              {txHash && (
                <div data-testid="rhea-xchain-tx" style={{ fontSize: 12, color: "var(--gain)", wordBreak: "break-all" }}>
                  Submitted from your wallet: {txHash}. The agent did not sign or submit it.
                </div>
              )}
              {status && (
                <div data-testid="rhea-xchain-status" style={{ fontSize: 12 }}>
                  1Click status: {status}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
            {signature
              ? "Your off-chain signature was used only to prepare the live quote."
              : "Nothing here is signed by SparkPoint. A dry review moves no funds."}
          </div>
        </Card>
      )}

      <Card testId="rhea-xchain-withdraw">
        <div style={{ fontSize: 15, fontWeight: 600 }}>Withdraw (honest review)</div>
        {withdraw ? (
          <>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>{withdraw.note}</div>
            <div style={{ fontSize: 12, color: MUTED }}>
              NEP-413 is a transaction: <strong>{withdraw.nep413IsTransaction ? "yes" : "no"}</strong> ·
              custodian: <strong>{withdraw.custodian ?? "none"}</strong>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {withdraw.paths.map((path) => (
                <div key={path.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 9, padding: "9px 11px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {path.label}{" "}
                    <span style={{ fontWeight: 400, color: MUTED }}>· {path.status}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>{path.note}</div>
                  {path.url && (
                    <a
                      href={path.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}
                    >
                      Open Rhea ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: MUTED }}>Reading the documented withdraw paths…</div>
        )}
      </Card>

      <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
        This is the 071 cross-chain MCA/1Click rail. 078&apos;s same-chain NEAR → Burrow supply is a
        separate flow. Nothing on this page is a transaction until your own wallet confirms the
        unsigned plan.
      </div>
    </div>
  );
}
