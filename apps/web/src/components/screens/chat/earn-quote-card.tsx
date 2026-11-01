"use client";

/**
 * 069/070 — the earn PREVIEW card, rendered inline in Sparky's thread.
 *
 * NON-CUSTODY / NOT SIGNABLE: this build has no confirm or send button for an earn quote. A live
 * 1Click Earn deposit is Phase C. The card shows the dry preview the agent produced (vault, rail,
 * amount in/out, ETA, fees, expiry). A Morpho 1Click receipt is a NEAR-issued wrapper, NOT the
 * native Morpho vault share; a Kamino receipt IS the native kVault share mint, and the card says
 * so. Kamino previews also collect a pasted base58 Solana recipient (068 validation): this is a
 * local shape check only, nothing is submitted, and the EVM connected wallet is never reused as a
 * Solana address. An Intents Connect plan renders as a read-only numbered list. Nothing here
 * carries calldata or a signature.
 *
 * `state="unavailable"` is an ordinary answer with a plain-language reason and no action — never an
 * error card.
 */

import { useState } from "react";
import { useAccount } from "wagmi";
import type { EarnQuoteBlock } from "@sparkpoint/shared/schemas";

import { expectedAddressDescription, isValidAddress } from "@/lib/crosschain/address";
import { formatEta, formatHumanAmount, formatUsd } from "@/lib/crosschain/format";
import {
  chainLabel,
  isNativeShares,
  needsSolanaRecipient,
  protocolLabel,
  protocolOf,
} from "@/lib/earn/format";

const MUTED = "var(--muted-foreground)";

const RAIL_LABEL: Record<EarnQuoteBlock["rail"], string> = {
  direct: "Direct same-chain deposit",
  oneclick_earn: "NEAR Intents 1Click Earn",
  intents_connect: "Aurora Intents Connect",
};

const MAINNET_WARNING =
  "Mainnet funds. SparkPoint never holds your funds — you review every step and deposit from your own wallet.";

function Row({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "caution" | "gain";
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span
        style={{
          color: tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--foreground)",
          fontWeight: 500,
          textAlign: "right",
          wordBreak: "break-word",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function Notice({
  children,
  tone = "info",
  testId,
}: {
  children: React.ReactNode;
  tone?: "caution" | "info" | "gain";
  testId?: string;
}) {
  const c = tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--info)";
  return (
    <div
      data-testid={testId}
      style={{
        marginTop: 10,
        fontSize: 12,
        lineHeight: 1.5,
        color: c,
        background: `color-mix(in srgb, ${c} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 26%, transparent)`,
        borderRadius: 10,
        padding: "8px 10px",
      }}
    >
      {children}
    </div>
  );
}

export function EarnQuoteCard({ block }: { block: EarnQuoteBlock }) {
  const { address } = useAccount();
  const [recipient, setRecipient] = useState("");
  const vault = block.vault;
  const vaultName = vault.name || vault.symbol;
  const protocol = protocolOf(vault);
  const receipt = vault.rails.oneclickEarn.receipt;
  const receiptSymbol = receipt?.symbol ?? vault.symbol;
  const isReceipt = block.rail === "oneclick_earn";
  const native = isNativeShares(block);
  const amountIn = block.amountIn ?? block.origin?.amount;

  const recipientRequired = needsSolanaRecipient(block);
  const recipientValue = recipient.trim();
  const recipientValid = recipientRequired && isValidAddress(recipientValue, "sol");
  const evmLooking = /^0x/i.test(recipientValue);
  const deposit = block.walletSupport?.deposit;

  return (
    <div
      className="ccard cf-card"
      data-card="earn-quote"
      data-state={block.state}
      data-rail={block.rail}
      data-protocol={protocol}
      data-receipt-kind={native ? "native_shares" : "wrapper"}
      style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}
    >
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{protocolLabel(protocol)} earn preview</div>
          <span style={{ fontSize: 11.5, color: MUTED }}>
            {block.state === "unavailable" ? "Unavailable" : "Dry preview · not signable"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
          {vaultName} on {chainLabel(vault.chain)} · {RAIL_LABEL[block.rail]} · {vault.asset.symbol}.
          Nothing is signed or sent.
        </div>
      </div>

      {block.state === "unavailable" ? (
        <div className="cf-sec" data-testid="earn-quote-unavailable">
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>This vault can&apos;t be previewed right now</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>
            {block.unavailableReason ?? "No enabled rail can reach this vault."} Nothing was signed or sent.
          </div>
          <Notice tone="info" testId="earn-quote-unavailable-hint">
            {/no liquidity/i.test(block.unavailableReason ?? "")
              ? "1Click has no liquidity for this size right now — try a smaller amount."
              : `You can try another vault or rail, or ask Sparky to list the ${protocolLabel(protocol)} vaults that are live today.`}
          </Notice>
        </div>
      ) : (
        <div className="cf-sec" data-testid="earn-quote-preview" style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
              You deposit
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }} className="tnum">
              {amountIn ? `${formatHumanAmount(amountIn)} ${vault.asset.symbol}` : vault.asset.symbol}
            </div>
            {block.origin && (
              <div style={{ fontSize: 12.5, color: MUTED }}>
                from {chainLabel(block.origin.chain)}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
              You receive (est.)
            </div>
            {isReceipt ? (
              <>
                <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }} className="tnum" data-testid="earn-quote-amount-out">
                  {block.amountOut ? `${formatHumanAmount(block.amountOut, 6)} ${receiptSymbol}` : "—"}
                </div>
                <div
                  data-testid="earn-quote-receipt-kind"
                  style={{ fontSize: 12.5, color: MUTED }}
                >
                  {block.amountOutUsd ? `≈ ${formatUsd(block.amountOutUsd)} · ` : ""}
                  {native ? "native Kamino shares" : "NEAR-issued receipt"}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>
                  {block.rail === "direct" ? "Native Morpho vault share" : "Native share via Intents Connect"}
                </div>
                <div style={{ fontSize: 12.5, color: MUTED }}>
                  {vault.asset.symbol} on {chainLabel(vault.chain)}
                </div>
              </>
            )}
          </div>

          <div style={{ display: "grid", gap: 5, fontSize: 12.5 }}>
            {block.timeEstimateSec !== undefined && (
              <Row k="Estimated time" v={formatEta(block.timeEstimateSec)} />
            )}
            <Row k="Vault" v={`${vaultName} (${vault.symbol})`} />
            <Row k="Rail" v={RAIL_LABEL[block.rail]} />
            {isReceipt && (
              <Row
                k="Receipt"
                v={`${receiptSymbol} · ${native ? "native kVault share" : "NEAR-issued wrapper"}`}
              />
            )}
            {block.feeNote && <Row k="Fees" v={block.feeNote} tone="caution" />}
          </div>

          {block.receiptNote && (
            <Notice tone={isReceipt && !native ? "caution" : "info"} testId="earn-quote-receipt-note">
              {block.receiptNote}
            </Notice>
          )}

          {recipientRequired && (
            <div
              data-testid="earn-recipient-step"
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 6,
              }}
            >
              <label htmlFor="earn-sol-recipient" style={{ fontSize: 12.5, fontWeight: 600 }}>
                Kamino share recipient (Solana)
              </label>
              <input
                id="earn-sol-recipient"
                data-testid="earn-sol-recipient"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                placeholder={expectedAddressDescription("sol")}
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: "10px 12px",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--foreground)",
                  outline: "none",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              />
              {recipientValue && !recipientValid && (
                <div data-testid="earn-recipient-error" style={{ fontSize: 11.5, color: "var(--caution)", lineHeight: 1.5 }}>
                  {evmLooking
                    ? "That's an EVM address. Kamino shares must go to a base58 Solana address (32–44 characters) — paste a Solana wallet address (Phantom etc.)."
                    : `That doesn't look like ${expectedAddressDescription("sol")}.`}
                </div>
              )}
              {recipientValid && (
                <div data-testid="earn-recipient-valid" style={{ fontSize: 11.5, color: "var(--gain)" }}>
                  Valid Solana address — this preview does not send it anywhere.
                </div>
              )}
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                This is never prefilled with your EVM wallet: Kamino shares are delivered on Solana, so
                the recipient must be a Solana address you control.
              </div>
            </div>
          )}

          {deposit === "copy_address" && (
            <Notice tone="info" testId="earn-deposit-copy-address">
              Send from your own Solana wallet (Phantom etc.) — copy-address deposit, phase C. This
              preview does not create a deposit address or move funds yet.
            </Notice>
          )}

          {deposit === "evm_wallet" && (
            <div
              data-testid="earn-deposit-evm-wallet"
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Deposit from your connected wallet</div>
              <div style={{ fontSize: 11.5, color: MUTED, wordBreak: "break-all" }}>
                {address
                  ? `${address} · ${block.origin ? chainLabel(block.origin.chain) : "EVM"} wallet`
                  : "Connect an EVM wallet to review the deposit source."}
              </div>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                data-testid="earn-deposit-disabled"
                disabled
                style={{ justifySelf: "start" }}
              >
                Deposit from wallet
              </button>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                Live deposits coming soon (phase C). This preview is not signable.
              </div>
            </div>
          )}

          {block.steps && block.steps.length > 0 && (
            <div data-testid="earn-quote-steps">
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
                Intents Connect plan (read-only)
              </div>
              <ol style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 12.5, lineHeight: 1.55 }}>
                {block.steps.map((step, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <code style={{ fontSize: 11.5 }}>{step.functionSignature}</code>
                    <div style={{ color: MUTED, fontSize: 11.5, wordBreak: "break-all" }}>
                      to {step.to}
                      {step.parameters.length > 0 ? ` · ${step.parameters.join(", ")}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
                These steps are data, not a transaction. The user address is filled in at execution
                time, and this build cannot submit them.
              </div>
            </div>
          )}

          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }} data-testid="earn-quote-expiry">
            {block.expiresHint ??
              "Dry preview — it does not move funds and does not expire on-chain. Re-run it for a fresh quote before you deposit."}
            {block.quotedAt ? ` Quoted ${block.quotedAt}.` : ""}
          </div>

          <Notice tone="info" testId="earn-quote-not-signable">
            Not signable in this build: there is no confirm or send button for a {protocolLabel(protocol)} earn preview
            here. Nothing is signed or sent.
          </Notice>

          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>{MAINNET_WARNING}</div>
        </div>
      )}
    </div>
  );
}
