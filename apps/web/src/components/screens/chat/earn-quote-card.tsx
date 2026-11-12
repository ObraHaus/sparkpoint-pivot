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
import { truncateNearAccount } from "@/lib/near/account";
import { useNearWallet } from "@/lib/near/NearWalletProvider";
import {
  buildRheaSignRequest,
  phaseCEnabledFromEnv,
  shouldOfferRheaSign,
} from "@/lib/near/phaseC";
import { rheaAccountSourceLabel, selectRheaAccount } from "@/lib/near/rhea";
import { publicXchainEnabled, xchainReviewHref } from "@/lib/earn/xchain";
import { formatEta, formatHumanAmount, formatUsd } from "@/lib/crosschain/format";
import {
  chainLabel,
  isNativeShares,
  needsSolanaRecipient,
  netSuppliedLine,
  oneTimeFeeLine,
  protocolLabel,
  protocolOf,
  rheaApyLine,
  sourceAttribution,
} from "@/lib/earn/format";
import {
  kaminoLiveEnabledFromEnv,
  liveEarnHref,
  morphoLiveEnabledFromEnv,
  rheaLiveEnabledFromEnv,
} from "@/lib/earn/liveFlags";
import { findKaminoVault } from "@/lib/earn/kaminoLive";
import { findMorphoVault } from "@/lib/earn/morphoLive";

const MUTED = "var(--muted-foreground)";

const RAIL_LABEL: Record<EarnQuoteBlock["rail"], string> = {
  direct: "Direct deposit",
  oneclick_earn: "NEAR Intents 1Click Earn",
  oneclick_rhea: "NEAR Intents 1Click → Rhea lending",
  intents_connect: "Alternate route",
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
  const { accountId: connectedNearAccountId, signMessage } = useNearWallet();
  const [recipient, setRecipient] = useState("");
  const [pastedNearAccount, setPastedNearAccount] = useState("");
  const [rheaSigning, setRheaSigning] = useState(false);
  const [rheaSignature, setRheaSignature] = useState<string | null>(null);
  const [rheaSignError, setRheaSignError] = useState<string | null>(null);
  const vault = block.vault;
  const vaultName = vault.name || vault.symbol;
  const protocol = protocolOf(vault);
  const isRhea = protocol === "rhea" || block.rail === "oneclick_rhea";
  const receipt = vault.rails.oneclickEarn?.receipt;
  const receiptSymbol = receipt?.symbol ?? vault.symbol;
  const isReceipt = block.rail === "oneclick_earn";
  const native = isNativeShares(block);
  const feeLine = isRhea ? oneTimeFeeLine(block.oneTimeFee) : null;
  const netLine = isRhea ? netSuppliedLine(block.netSupplied, vault.asset.symbol) : null;
  const amountIn = block.amountIn ?? block.origin?.amount;
  // 079 — cross-chain Rhea (071 MCA/1Click) review entry point, off unless the public flag is on.
  const xchainReview =
    isRhea && publicXchainEnabled()
      ? xchainReviewHref({
          chain: "near",
          origin: block.origin?.key,
          vault: vault.address,
          amount: amountIn,
        })
      : null;

  // 077 — the one live direct rail available for this preview, if the build flag is on. This
  // bypasses the 1Click receipt and opens the shared /vault/live review flow; it never signs.
  const liveProtocol =
    protocol === "kamino" &&
    kaminoLiveEnabledFromEnv() &&
    findKaminoVault(vault.address) !== null
      ? "kamino"
      : protocol === "morpho" &&
          vault.chain === "base" &&
          morphoLiveEnabledFromEnv() &&
          findMorphoVault(vault.address) !== null
        ? "morpho"
        : null;
  const liveHref = (mode: "deposit" | "withdraw") =>
    liveProtocol
      ? liveEarnHref({
          protocol: liveProtocol,
          chain: vault.chain,
          vault: vault.address,
          asset: vault.asset.symbol,
          mode,
          amount: mode === "deposit" ? (amountIn ?? undefined) : undefined,
        })
      : null;

  // 1110 — a Morpho/Kamino withdraw request routes here with a `withdraw` deep link. Render a
  // compact withdraw card instead of the deposit-preview sections (which describe the wrong move).
  const withdrawOnly = block.withdraw && !isRhea ? block.withdraw : null;
  if (withdrawOnly) {
    return (
      <div
        className="ccard cf-card"
        data-card="earn-quote"
        data-state="preview"
        data-rail={block.rail}
        data-protocol={protocol}
        data-mode="withdraw"
        style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}
      >
        <div className="cf-hd">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{protocolLabel(protocol)} withdraw</div>
            <span style={{ fontSize: 11.5, color: MUTED }}>Review in your wallet</span>
          </div>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
            {vaultName} on {chainLabel(vault.chain)} · {vault.asset.symbol}. Nothing is signed or
            sent here.
          </div>
        </div>
        <div className="cf-sec" style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55 }}>
            Open the same live withdraw card the Vault page uses: you review the amount, accounts
            and fees, then sign in your own wallet.
          </div>
          <a
            className="btn btn-primary btn-sm"
            href={withdrawOnly.url}
            data-testid="earn-withdraw-link"
            style={{ justifySelf: "start" }}
          >
            Review withdraw on {protocolLabel(protocol)}
          </a>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
            {withdrawOnly.note} Nothing is signed or sent here.
          </div>
        </div>
      </div>
    );
  }

  const recipientRequired = needsSolanaRecipient(block);
  const recipientValue = recipient.trim();
  const recipientValid = recipientRequired && isValidAddress(recipientValue, "sol");
  const evmLooking = /^0x/i.test(recipientValue);
  const deposit = block.walletSupport?.deposit;

  // 075 — Phase C is OFF unless the build flag says otherwise. The connected NEAR account is the
  // signer; the Rhea preview's server-derived recipient remains the account funds are addressed to.
  const phaseCEnabled = phaseCEnabledFromEnv();
  const rheaAccount = selectRheaAccount({
    connectedNearAccountId,
    pasted: pastedNearAccount,
    rheaRecipient: block.recipient,
  });
  const canSignRhea = shouldOfferRheaSign({
    enabled: phaseCEnabled,
    accountId: rheaAccount.source === "connected" ? rheaAccount.accountId : null,
    messageToSign: block.messageToSign,
  });

  async function signRheaMessage() {
    if (!canSignRhea || !block.messageToSign || rheaSigning) return;
    setRheaSigning(true);
    setRheaSignError(null);
    try {
      // SIGNING ONLY: a NEP-413 off-chain signature. It is never submitted, and the deposit
      // button below stays disabled regardless of the result.
      const signed = await signMessage(buildRheaSignRequest(block.messageToSign));
      setRheaSignature(signed.signature);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      setRheaSignError(
        /rejected|denied|cancel/i.test(raw)
          ? "You cancelled the NEAR signature. Nothing was signed or sent."
          : raw || "The NEAR wallet could not sign that message.",
      );
    } finally {
      setRheaSigning(false);
    }
  }

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
            {block.unavailableReason ?? "No live route is available for this vault right now."} Nothing
            was signed or sent.
          </div>
          <Notice tone="info" testId="earn-quote-unavailable-hint">
            {/no liquidity/i.test(block.unavailableReason ?? "")
              ? "1Click has no liquidity for this size right now — try a smaller amount."
              : `You can try another vault or route, or ask Sparky to list the ${protocolLabel(protocol)} vaults that are live today.`}
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
            {isRhea ? (
              <>
                <div
                  style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}
                  className="tnum"
                  data-testid="earn-quote-amount-out"
                >
                  {block.amountOut
                    ? `${formatHumanAmount(block.amountOut, 6)} ${vault.asset.symbol}`
                    : "—"}
                </div>
                <div style={{ fontSize: 12.5, color: MUTED }} data-testid="earn-rhea-receive-note">
                  {block.amountOutUsd ? `≈ ${formatUsd(block.amountOutUsd)} · ` : ""}
                  supplied to your Rhea (Burrow) account on NEAR
                </div>
              </>
            ) : isReceipt ? (
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
                  {block.rail === "direct" ? "Native Morpho vault share" : "Native share delivery"}
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
            <Row k="Route" v={RAIL_LABEL[block.rail]} />
            {isReceipt && (
              <Row
                k="Receipt"
                v={`${receiptSymbol} · ${native ? "native kVault share" : "NEAR-issued wrapper"}`}
              />
            )}
            {block.feeNote && <Row k="Fees" v={block.feeNote} tone="caution" />}
          </div>

          {isRhea && (block.supplyApy || block.source) && (
            <div
              data-testid="earn-rhea-rate"
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 4,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {rheaApyLine(block.supplyApy) && (
                <div style={{ fontWeight: 600 }}>{rheaApyLine(block.supplyApy)}</div>
              )}
              {block.source && (
                <div style={{ color: MUTED }} data-testid="earn-rhea-source">
                  {sourceAttribution(block.source)}{" "}
                  <a
                    href={block.source.uiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--primary)", fontWeight: 600 }}
                  >
                    source ↗
                  </a>
                </div>
              )}
              <div style={{ color: MUTED }}>
                Variable rate: the contract&apos;s supply APR moves with utilization; it is not a
                fixed yield. Farm rewards, if any, are not included.
              </div>
            </div>
          )}

          {(feeLine || netLine) && (
            <div
              data-testid="earn-rhea-fee-block"
              style={{
                border: "1px solid color-mix(in srgb, var(--caution) 26%, transparent)",
                background: "color-mix(in srgb, var(--caution) 8%, transparent)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 3,
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >
              {feeLine && (
                <div data-testid="earn-rhea-one-time-fee" style={{ fontWeight: 600 }}>
                  {feeLine}
                </div>
              )}
              {netLine && <div data-testid="earn-rhea-net-supplied">{netLine}</div>}
            </div>
          )}

          {isRhea && block.recipient && (
            <div
              data-testid="earn-rhea-recipient"
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 5,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {block.firstDeposit
                  ? "Rhea account — created on your first deposit"
                  : "Your Rhea account"}
              </div>
              <div
                data-testid="earn-rhea-recipient-value"
                style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, wordBreak: "break-all" }}
              >
                {block.recipient}
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                Read-only and derived from your connected wallet — not user-entered.{" "}
                {block.firstDeposit
                  ? "Your first deposit creates your Rhea account automatically."
                  : "Supplies go to this existing Rhea account."}
              </div>
            </div>
          )}

          {isRhea && (
            <div
              data-testid="earn-rhea-near-account"
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 5,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Your NEAR wallet</div>
              <div
                data-testid="earn-rhea-near-account-value"
                style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, wordBreak: "break-all" }}
              >
                {rheaAccount.accountId ? truncateNearAccount(rheaAccount.accountId) : "Not connected"}
              </div>
              <div data-testid="earn-rhea-near-account-source" style={{ fontSize: 11.5, color: MUTED }}>
                {rheaAccountSourceLabel(rheaAccount.source)}. This is a client-side claim, never server
                authentication, and it adds no access key.
              </div>
              {phaseCEnabled && !connectedNearAccountId && (
                <div style={{ display: "grid", gap: 4 }}>
                  <label htmlFor="earn-rhea-paste-near" style={{ fontSize: 11.5, fontWeight: 600 }}>
                    Fallback: paste a NEAR account (read-only)
                  </label>
                  <input
                    id="earn-rhea-paste-near"
                    data-testid="earn-rhea-paste-near"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={pastedNearAccount}
                    onChange={(event) => setPastedNearAccount(event.target.value)}
                    placeholder="sparkpoint2026.near"
                    style={{
                      width: "100%",
                      fontSize: 12,
                      padding: "8px 10px",
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 9,
                      color: "var(--foreground)",
                      outline: "none",
                      fontFamily: "var(--font-mono, monospace)",
                    }}
                  />
                  <div style={{ fontSize: 11, color: MUTED }}>
                    A pasted account can be shown, not signed with. Connect Meteor to sign.
                  </div>
                </div>
              )}
            </div>
          )}

          {isRhea && block.firstDeposit && block.messageToSign && (
            <details
              data-testid="earn-rhea-message"
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "9px 11px",
                fontSize: 12,
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                You&apos;ll sign this message in your wallet to create your Rhea account
              </summary>
              <pre
                data-testid="earn-rhea-message-text"
                style={{
                  margin: "8px 0 4px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11.5,
                }}
              >
                {block.messageToSign}
              </pre>
              <div style={{ color: MUTED, lineHeight: 1.5 }}>
                {phaseCEnabled
                  ? "Display only unless you explicitly choose to sign below. Nothing is sent, and the deposit button stays disabled."
                  : "Display only — this build does not sign it or ask your wallet to sign. Nothing is signed or sent."}
              </div>
              {phaseCEnabled && (
                <div data-testid="earn-rhea-phase-c" style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    data-testid="earn-rhea-sign"
                    disabled={!canSignRhea || rheaSigning}
                    onClick={() => void signRheaMessage()}
                    style={{ justifySelf: "start" }}
                  >
                    {rheaSigning ? "Waiting for your NEAR wallet…" : "Sign in your wallet (NEP-413)"}
                  </button>
                  <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                    Signs the message with your connected NEAR wallet. This is SIGNING ONLY — the
                    signature is not submitted anywhere, no transaction is built and nothing is sent.
                  </div>
                  {!canSignRhea && (
                    <div data-testid="earn-rhea-sign-blocked" style={{ fontSize: 11.5, color: "var(--caution)", lineHeight: 1.5 }}>
                      Connect a NEAR wallet (Meteor) and select a valid account to enable signing.
                    </div>
                  )}
                  {rheaSignature && (
                    <div
                      data-testid="earn-rhea-signature"
                      style={{ fontSize: 11.5, color: "var(--gain)", lineHeight: 1.5, wordBreak: "break-all" }}
                    >
                      Signature ready (signing only, not submitted): {truncateNearAccount(rheaSignature, 14, 10)}
                    </div>
                  )}
                  {rheaSignError && (
                    <div data-testid="earn-rhea-sign-error" style={{ fontSize: 11.5, color: "var(--loss)", lineHeight: 1.5 }}>
                      {rheaSignError}
                    </div>
                  )}
                </div>
              )}
            </details>
          )}

          {isRhea && xchainReview && (
            <div
              data-testid="earn-rhea-xchain-review"
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>Review the cross-chain deposit</div>
              <a
                className="btn btn-outline btn-sm"
                href={xchainReview}
                style={{ justifySelf: "start" }}
              >
                Open cross-chain review
              </a>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                Deposit USDC from Base or Ethereum into your Rhea account on NEAR. Start with a
                preview that moves no funds; a live step only prepares a transfer for your own wallet
                to approve. SparkPoint never signs for you.
              </div>
            </div>
          )}

          {isRhea && (
            <div
              data-testid="earn-rhea-deposit"
              style={{
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 6,
              }}
            >
              <button
                type="button"
                className="btn btn-outline btn-sm"
                data-testid="earn-rhea-deposit-disabled"
                disabled
                style={{ justifySelf: "start" }}
              >
                Deposit
              </button>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                This cross-chain preview can&apos;t be signed yet. You can supply or withdraw USDC
                directly on NEAR when the live option is available.
              </div>
              {rheaLiveEnabledFromEnv() && (
                <a
                  data-testid="earn-rhea-live-link"
                  href={liveEarnHref({
                    protocol: "rhea",
                    chain: vault.chain,
                    vault: vault.address,
                    asset: vault.asset.symbol,
                    mode: "deposit",
                  })}
                  className="btn btn-primary btn-sm"
                  style={{ justifySelf: "start" }}
                >
                  Supply or withdraw USDC on NEAR
                </a>
              )}
            </div>
          )}

          {isRhea && block.withdraw && (
            <div data-testid="earn-rhea-withdraw-block" style={{ display: "grid", gap: 4 }}>
              <a
                data-testid="earn-rhea-withdraw"
                href={block.withdraw.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--primary)",
                  textDecoration: "none",
                  justifySelf: "start",
                }}
              >
                Withdraw on Rhea ↗
              </a>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                {block.withdraw.note}. Nothing is signed or sent here.
              </div>
            </div>
          )}

          {liveHref("deposit") && block.state === "preview" && (
            <div
              data-testid="earn-live-cta"
              style={{
                border: "1px solid color-mix(in srgb, var(--primary) 30%, transparent)",
                background: "color-mix(in srgb, var(--primary) 8%, transparent)",
                borderRadius: 10,
                padding: "10px 11px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                Live {protocolLabel(protocol)}
              </div>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                {protocol === "kamino"
                  ? "Uses your connected Solana wallet. Kamino builds an unsigned transaction; you review the amounts, accounts and fees, then sign in your wallet."
                  : "Uses your connected Base wallet. Approve (only if needed) + deposit via ERC-4626; you review, then sign in your wallet."}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  className="btn btn-primary btn-sm"
                  href={liveHref("deposit")!}
                  data-testid="earn-live-deposit"
                >
                  Review live deposit
                </a>
                <a
                  className="btn btn-outline btn-sm"
                  href={liveHref("withdraw")!}
                  data-testid="earn-live-withdraw"
                >
                  Live withdraw
                </a>
              </div>
              <div style={{ fontSize: 11, color: MUTED }}>
                This is the direct deposit flow, separate from the 1Click preview above.
              </div>
            </div>
          )}

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
              Send from your own Solana wallet (Phantom etc.) — copy-address deposit. This preview
              does not create a deposit address or move funds yet.
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
                This preview is not signable yet — nothing is sent or signed.
              </div>
            </div>
          )}

          {block.steps && block.steps.length > 0 && (
            <div data-testid="earn-quote-steps">
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
                Read-only plan
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
            This {protocolLabel(protocol)} earn preview can’t be signed yet — there is no confirm or send button.
            here. Nothing is signed or sent.
          </Notice>

          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>{MAINNET_WARNING}</div>
        </div>
      )}
    </div>
  );
}
