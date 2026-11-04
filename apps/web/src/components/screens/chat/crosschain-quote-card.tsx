"use client";

/**
 * 068 — the cross-chain swap card, rendered inline in Sparky's thread.
 *
 * NON-CUSTODY: this card never signs, never holds a key and never moves funds on its own. It walks
 * the user through a dry PREVIEW → destination/refund RECIPIENT → explicit CONFIRM (a live 1Click
 * quote) → DEPOSIT (the user sends from their own wallet) → live STATUS. The only transaction the
 * app can ever send is the user's own ERC-20 transfer, and only after they tap "Send from wallet";
 * nothing is auto-sent.
 *
 * `state="unavailable"` (Tron today, or 1Click's 400 for no liquidity/minimum) is an ordinary
 * answer with a plain-language reason and no action button — never an error card.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { erc20Abi, type Address, type Hex } from "viem";
import type { CrossChainQuoteBlock } from "@sparkpoint/shared/schemas";

import { Icon } from "@/lib/icons";
import { wagmiConfig } from "@/lib/wagmi";
import { useNearWallet } from "@/lib/near/NearWalletProvider";
import { resolveCrossChainRecipient } from "@/lib/near/recipient";
import { swapTokens } from "@/lib/swap/tokens";
import {
  addressKindForOrigin,
  expectedAddressDescription,
  isValidAddress,
} from "@/lib/crosschain/address";
import {
  formatCountdown,
  formatEta,
  formatHumanAmount,
  formatSlippage,
  formatUsd,
} from "@/lib/crosschain/format";
import { isTerminalStatus, pollDelayMs, statusView } from "@/lib/crosschain/status";
import { canSendFromWallet, humanToBaseUnits } from "@/lib/crosschain/walletSend";
import {
  depositStorageKey,
  readDepositSnapshot,
  writeDepositSnapshot,
  type DepositSnapshot,
} from "@/lib/crosschain/depositStorage";
import "@/components/screens/confirm.css";

const MUTED = "var(--muted-foreground)";
const REGISTERED_CHAIN_IDS = wagmiConfig.chains.map((chain) => chain.id);
type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

/** The HTTP quote response (`state="live"` adds the deposit address/deadline). */
interface HttpQuote extends Omit<CrossChainQuoteBlock, "type" | "state"> {
  state: "preview" | "live" | "unavailable";
  depositAddress?: string;
  deadline?: string;
  quoteId?: number;
}

type Stage = "preview" | "recipient" | "confirm" | "deposit";

function nowMs(): number {
  return Date.now();
}

const MAINNET_WARNING =
  "Mainnet funds. SparkPoint never holds your funds — you send from your own wallet to a one-time 1Click deposit address. If the swap can't complete, funds are refunded to your refund address.";

function Row({ k, v, tone }: { k: string; v: string; tone?: "caution" | "gain" }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span
        style={{
          color: tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--foreground)",
          fontWeight: 500,
          textAlign: "right",
          wordBreak: "break-all",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function Notice({
  children,
  tone = "caution",
}: {
  children: React.ReactNode;
  tone?: "caution" | "info" | "gain";
}) {
  const c = tone === "info" ? "var(--info)" : tone === "gain" ? "var(--gain)" : "var(--caution)";
  return (
    <div
      style={{
        marginTop: 12,
        fontSize: 12.5,
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

async function errorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null) {
      const error = (body as { error?: unknown }).error;
      if (typeof error === "object" && error !== null) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) return message;
      }
      const message = (body as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  } catch {
    // fall through to the status-based message
  }
  return `The cross-chain service answered ${res.status}. Please try again.`;
}

function walletErrorCopy(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (/user rejected|denied|rejected request/i.test(raw)) return "You cancelled the wallet request. Nothing was sent.";
  if (/insufficient/i.test(raw)) return "Your wallet doesn't have enough of this token for that transfer.";
  return raw || "The wallet couldn't send that transaction.";
}

export function CrossChainQuoteCard({
  block,
  conversationId,
}: {
  block: CrossChainQuoteBlock;
  conversationId?: string;
}) {
  const { address, chainId, isConnected } = useAccount();
  const { accountId: nearAccountId } = useNearWallet();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [stage, setStage] = useState<Stage>("preview");
  // User edits override the connected-wallet defaults (derived below, never set in an effect).
  const [recipientOverride, setRecipientOverride] = useState<string | null>(null);
  const [refundOverride, setRefundOverride] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<DepositSnapshot | null>(null);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => nowMs());
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletTxHash, setWalletTxHash] = useState<Hex | null>(null);

  const statusRef = useRef<string | undefined>(undefined);
  const pollStartedAt = useRef(0);

  const originKind = addressKindForOrigin(block.origin.chain, block.origin.evmChainId);
  const destinationKind = block.destination.addressKind;
  const evmOrigin = originKind === "evm";

  // The destination defaults to the connected wallet for the matching family (EVM as before, and
  // 075 adds a connected NEAR account for a NEAR destination), but stays editable. The refund
  // address for an EVM origin is always the connected wallet (shown read-only); a non-EVM origin
  // needs its own refund address input.
  const recipientSelection = resolveCrossChainRecipient({
    destinationKind,
    recipientOverride,
    evmAddress: address,
    nearAccountId,
  });
  const recipient = recipientSelection.value;
  const refundTo = evmOrigin ? (address ?? "") : (refundOverride ?? "");

  const storageKey = useMemo(
    () => depositStorageKey(conversationId, block),
    [conversationId, block],
  );

  // Resume an in-progress deposit after refresh / reopening this conversation. `sessionStorage`
  // is an external store, so reading it once on mount and seeding React state here is the sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (block.state !== "preview" || typeof window === "undefined") return;
    const saved = readDepositSnapshot(window.sessionStorage, storageKey);
    if (!saved) return;
    setDeposit(saved);
    setRecipientOverride(saved.recipient);
    setRefundOverride(saved.refundTo);
    setStatus(saved.status);
    statusRef.current = saved.status;
    pollStartedAt.current = nowMs();
    setStage("deposit");
  }, [block.state, storageKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Persist the deposit (and the latest observed status) for this tab/session.
  useEffect(() => {
    if (!deposit || typeof window === "undefined") return;
    writeDepositSnapshot(window.sessionStorage, storageKey, { ...deposit, status });
  }, [deposit, status, storageKey]);

  // Live countdown to the 1Click deadline.
  useEffect(() => {
    if (!deposit?.deadline) return;
    const id = setInterval(() => setNow(nowMs()), 1_000);
    return () => clearInterval(id);
  }, [deposit?.deadline]);

  // Poll status every 5s (backing off after 10 min), stop on terminal states/unmount.
  useEffect(() => {
    if (!deposit) return;
    if (isTerminalStatus(statusRef.current)) return;
    if (pollStartedAt.current === 0) pollStartedAt.current = nowMs();

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const tick = async () => {
      if (cancelled) return;
      controller = new AbortController();
      try {
        const res = await fetch(
          `/api/agent/crosschain/status?depositAddress=${encodeURIComponent(deposit.depositAddress)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!res.ok) throw new Error(await errorMessage(res));
        const body = (await res.json()) as { status?: unknown };
        if (cancelled) return;
        const next = typeof body.status === "string" ? body.status : undefined;
        statusRef.current = next;
        setStatus(next);
        setStatusError(null);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) return;
        setStatusError("Couldn't refresh the status just now — retrying.");
      }
      if (cancelled || isTerminalStatus(statusRef.current)) return;
      timer = setTimeout(tick, pollDelayMs(nowMs() - pollStartedAt.current));
    };

    timer = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [deposit]);

  const originToken = useMemo(() => {
    if (typeof block.origin.evmChainId !== "number") return undefined;
    return swapTokens(block.origin.evmChainId).find(
      (token) => !token.isNative && token.symbol.toUpperCase() === block.origin.symbol.toUpperCase(),
    );
  }, [block.origin.evmChainId, block.origin.symbol]);

  const amountInUnits = useMemo(
    () =>
      originToken ? humanToBaseUnits(block.origin.amount, originToken.decimals) : null,
    [originToken, block.origin.amount],
  );

  const walletSendAvailable =
    canSendFromWallet(block.origin.evmChainId, REGISTERED_CHAIN_IDS) &&
    !!originToken &&
    amountInUnits !== null;

  const recipientValid = isValidAddress(recipient, destinationKind);
  const refundValid = evmOrigin ? isValidAddress(refundTo, "evm") : originKind ? isValidAddress(refundTo, originKind) : false;
  const canContinue = recipientValid && refundValid && (!evmOrigin || !!address);

  const copyDepositAddress = useCallback(async () => {
    if (!deposit) return;
    try {
      await navigator.clipboard.writeText(deposit.depositAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }, [deposit]);

  async function requestDepositAddress() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/crosschain/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originKey: block.origin.key,
          destinationKey: block.destination.key,
          amount: block.origin.amount,
          recipient: recipient.trim(),
          refundTo: refundTo.trim(),
          dry: false,
        }),
      });
      if (!res.ok) {
        setError(await errorMessage(res));
        return;
      }
      const body = (await res.json()) as HttpQuote;
      if (body.state === "unavailable") {
        setError(body.unavailableReason ?? "This route is unavailable right now. Nothing was sent.");
        return;
      }
      if (!body.depositAddress) {
        setError("The quote did not return a deposit address. Nothing was sent — please retry.");
        return;
      }
      const snapshot: DepositSnapshot = {
        depositAddress: body.depositAddress,
        deadline: body.deadline,
        recipient: recipient.trim(),
        refundTo: refundTo.trim(),
        status: "PENDING_DEPOSIT",
        quoteId: body.quoteId,
      };
      pollStartedAt.current = nowMs();
      statusRef.current = "PENDING_DEPOSIT";
      setStatus("PENDING_DEPOSIT");
      setStatusError(null);
      setDeposit(snapshot);
      setAck(false);
      setStage("deposit");
    } catch {
      setError("Couldn't reach the cross-chain service. Nothing was sent — please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendFromWallet() {
    if (!deposit || !originToken || amountInUnits === null) return;
    if (typeof block.origin.evmChainId !== "number") return;
    const targetChainId = block.origin.evmChainId as WagmiChainId;
    setWalletBusy(true);
    setWalletError(null);
    try {
      if (chainId !== targetChainId) {
        await switchChainAsync({ chainId: targetChainId });
      }
      const hash = await writeContractAsync({
        address: originToken.address as Address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [deposit.depositAddress as Address, amountInUnits],
        chainId: targetChainId,
      });
      setWalletTxHash(hash);
      const res = await fetch("/api/agent/crosschain/deposit/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ depositAddress: deposit.depositAddress, txHash: hash }),
      });
      if (!res.ok) {
        setWalletError(
          "Your transaction was sent, but the speed-up notice couldn't be recorded. Status will still update automatically.",
        );
      }
    } catch (err) {
      setWalletError(walletErrorCopy(err));
    } finally {
      setWalletBusy(false);
    }
  }

  const view = statusView(status);
  const activeStep = view.step;

  return (
    <div
      className="ccard cf-card"
      data-card="crosschain"
      data-state={block.state}
      data-stage={stage}
      style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}
    >
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Cross-chain swap</div>
          <span style={{ fontSize: 11.5, color: MUTED }}>
            {block.state === "unavailable" ? "Unavailable" : "Non-custodial"}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>
          {block.origin.chainLabel} → {block.destination.chainLabel}. You review every step and send from your own
          wallet. <b>SparkPoint never holds your funds.</b>
        </div>
      </div>

      {block.state === "unavailable" ? (
        <div className="cf-sec" data-testid="cc-unavailable">
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>This route isn&apos;t available right now</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.55 }}>
            {block.unavailableReason ?? "1Click is not quoting this pair right now."} Nothing was signed or sent.
          </div>
          <Notice tone="info">
            You can try another destination, or ask Sparky for a route that is live today.
          </Notice>
        </div>
      ) : stage === "preview" ? (
        <div className="cf-sec" data-testid="cc-preview" style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
              You send
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }} className="tnum">
              {formatHumanAmount(block.origin.amount)} {block.origin.symbol}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED }}>
              on {block.origin.chainLabel}
              {block.amountInUsd ? ` · ${formatUsd(block.amountInUsd)}` : ""}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
              You receive (est.)
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }} className="tnum">
              {block.amountOut ? `${formatHumanAmount(block.amountOut)} ${block.destination.symbol}` : "—"}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED }}>
              on {block.destination.chainLabel}
              {block.amountOutUsd ? ` · ${formatUsd(block.amountOutUsd)}` : ""}
            </div>
          </div>
          <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
            <Row k="Minimum received" v={block.minAmountOut ? `${formatHumanAmount(block.minAmountOut)} ${block.destination.symbol}` : "—"} />
            <Row k="Estimated time" v={formatEta(block.timeEstimateSec)} />
            <Row k="Max slippage" v={formatSlippage(block.slippageBps)} />
            {block.feeNote && <Row k="Fees" v={block.feeNote} />}
          </div>
          <Notice>{MAINNET_WARNING}</Notice>
          {block.expiresHint && <div style={{ fontSize: 11.5, color: MUTED }}>{block.expiresHint}</div>}
          <button className="btn btn-primary btn-md" style={{ width: "100%" }} onClick={() => setStage("recipient")}>
            Continue
          </button>
        </div>
      ) : stage === "recipient" ? (
        <div className="cf-sec" data-testid="cc-recipient-step" style={{ display: "grid", gap: 12 }}>
          <div>
            <label htmlFor="cc-recipient" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {block.destination.symbol} destination on {block.destination.chainLabel}
            </label>
            <input
              id="cc-recipient"
              data-testid="cc-recipient"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={recipient}
              onChange={(event) => setRecipientOverride(event.target.value)}
              placeholder={expectedAddressDescription(destinationKind)}
              style={{
                width: "100%",
                marginTop: 6,
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
            {recipient.trim() && !recipientValid && (
              <div style={{ fontSize: 11.5, color: "var(--caution)", marginTop: 5 }}>
                That doesn&apos;t look like {expectedAddressDescription(destinationKind)}.
              </div>
            )}
            {recipientSelection.source === "near" && (
              <div data-testid="cc-recipient-near" style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>
                Prefilled from your connected NEAR wallet ({nearAccountId}). Edit it if you want to send
                somewhere else — this account is a client-side claim, not server sign-in.
              </div>
            )}
            {destinationKind === "evm" && !isConnected && (
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>
                Connect your wallet to prefill your own address — you can still paste another EVM address.
              </div>
            )}
            {destinationKind === "near" && !nearAccountId && (
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }}>
                Connect a NEAR wallet (Meteor) to prefill it — you can still paste another NEAR account id.
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>Refund address</div>
            {evmOrigin ? (
              isConnected && address ? (
                <div
                  data-testid="cc-refund-readonly"
                  style={{ fontSize: 12, color: MUTED, marginTop: 5, wordBreak: "break-all", fontFamily: "var(--font-mono, monospace)" }}
                >
                  {address} · your connected wallet
                </div>
              ) : (
                <Notice>
                  Connect your wallet first — the refund address for an EVM origin is your own connected wallet.{" "}
                  <a className="btn btn-outline btn-sm" href="/connect" style={{ marginLeft: 8 }}>
                    Connect wallet
                  </a>
                </Notice>
              )
            ) : (
              <>
                <input
                  data-testid="cc-refund"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={refundTo}
                  onChange={(event) => setRefundOverride(event.target.value)}
                  placeholder={`Refund address on ${block.origin.chainLabel}`}
                  style={{
                    width: "100%",
                    marginTop: 6,
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
                {refundTo.trim() && !refundValid && originKind && (
                  <div style={{ fontSize: 11.5, color: "var(--caution)", marginTop: 5 }}>
                    That doesn&apos;t look like {expectedAddressDescription(originKind)}.
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
            The refund address is where 1Click returns your funds if the swap can&apos;t complete. Use an address you
            control — never someone else&apos;s.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-outline btn-md" onClick={() => setStage("preview")}>
              Back
            </button>
            <button
              className="btn btn-primary btn-md"
              style={{ flex: 1 }}
              disabled={!canContinue}
              onClick={() => {
                setError(null);
                setStage("confirm");
              }}
            >
              Review
            </button>
          </div>
        </div>
      ) : stage === "confirm" ? (
        <div className="cf-sec" data-testid="cc-confirm" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
            <Row k="You send" v={`${formatHumanAmount(block.origin.amount)} ${block.origin.symbol} on ${block.origin.chainLabel}`} />
            <Row k="You receive (est.)" v={block.amountOut ? `${formatHumanAmount(block.amountOut)} ${block.destination.symbol}` : "—"} />
            <Row k="Minimum received" v={block.minAmountOut ? `${formatHumanAmount(block.minAmountOut)} ${block.destination.symbol}` : "—"} />
            <Row k="Recipient" v={recipient.trim()} />
            <Row k="Refund to" v={refundTo.trim()} />
            <Row k="Estimated time" v={formatEta(block.timeEstimateSec)} />
            <Row k="Max slippage" v={formatSlippage(block.slippageBps)} />
          </div>
          {block.feeNote && <div style={{ fontSize: 11.5, color: MUTED }}>{block.feeNote}</div>}
          <Notice>{MAINNET_WARNING}</Notice>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.45, cursor: "pointer" }}>
            <input
              data-testid="cc-ack"
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              I understand this uses mainnet funds, SparkPoint never holds my funds, and I&apos;ll send the exact amount
              from my own wallet to the one-time deposit address.
            </span>
          </label>
          {error && (
            <div data-testid="cc-error" style={{ fontSize: 12.5, color: "var(--loss)", lineHeight: 1.5 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-outline btn-md" onClick={() => setStage("recipient")} disabled={submitting}>
              Back
            </button>
            <button
              className="btn btn-primary btn-md"
              style={{ flex: 1 }}
              disabled={!ack || submitting}
              onClick={() => void requestDepositAddress()}
            >
              {submitting ? "Getting deposit address…" : "Get deposit address"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
            This only asks 1Click for a live quote and a one-time deposit address. Nothing is signed and no funds move.
          </div>
        </div>
      ) : (
        <div className="cf-sec" data-testid="cc-deposit" style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: MUTED }}>
              Send exactly
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }} className="tnum">
              {formatHumanAmount(block.origin.amount)} {block.origin.symbol}
            </div>
            <div style={{ fontSize: 12.5, color: MUTED }}>
              {block.origin.symbol} on {block.origin.chainLabel} → {block.destination.symbol} on {block.destination.chainLabel}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>One-time 1Click deposit address</div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch", marginTop: 6 }}>
              <code
                data-testid="cc-deposit-address"
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  lineHeight: 1.5,
                  padding: "9px 10px",
                  background: "var(--muted)",
                  borderRadius: 9,
                  wordBreak: "break-all",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {deposit?.depositAddress ?? "—"}
              </code>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => void copyDepositAddress()}
                disabled={!deposit}
                aria-label="Copy deposit address"
              >
                <Icon name={copied ? "check" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
            {deposit?.deadline && (
              <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }} data-testid="cc-deadline">
                Send before the quote expires: <b>{formatCountdown(deposit.deadline, now)}</b>
              </div>
            )}
          </div>

          {walletSendAvailable ? (
            <div style={{ display: "grid", gap: 8 }}>
              <button
                className="btn btn-primary btn-md"
                data-testid="cc-wallet-send"
                disabled={walletBusy || !!walletTxHash}
                onClick={() => void sendFromWallet()}
              >
                <Icon name="wallet" size={15} />{" "}
                {walletTxHash ? "Transaction sent" : walletBusy ? "Waiting for wallet…" : "Send from wallet"}
              </button>
              <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5 }}>
                This sends the exact amount from your connected wallet as an ERC-20 transfer. It is the only
                transaction you sign — nothing is auto-sent.
              </div>
              {walletTxHash && (
                <div style={{ fontSize: 11.5, color: MUTED, wordBreak: "break-all" }}>
                  Transaction: {walletTxHash}
                </div>
              )}
              {walletError && <div style={{ fontSize: 12.5, color: "var(--loss)", lineHeight: 1.5 }}>{walletError}</div>}
            </div>
          ) : (
            <div data-testid="cc-send-instruction" style={{ fontSize: 13, lineHeight: 1.55 }}>
              Send <b>{formatHumanAmount(block.origin.amount)} {block.origin.symbol}</b> on{" "}
              <b>{block.origin.chainLabel}</b> to this address from your wallet. This build can&apos;t send it for you.
            </div>
          )}

          <Notice>{MAINNET_WARNING}</Notice>

          <div data-testid="cc-status" data-status={view.status}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{view.label}</div>
              <span style={{ fontSize: 11, color: view.tone === "success" ? "var(--gain)" : view.tone === "attention" ? "var(--caution)" : MUTED }}>
                {view.status}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{view.description}</div>
            {activeStep !== null && (
              <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
                {["Deposited", "Detected", "Swapping", "Done"].map((label, index) => (
                  <div key={label} style={{ flex: 1 }}>
                    <div
                      style={{
                        height: 4,
                        borderRadius: 2,
                        background:
                          index <= activeStep
                            ? view.tone === "success"
                              ? "var(--gain)"
                              : "var(--primary)"
                            : "var(--border)",
                      }}
                    />
                    <div style={{ fontSize: 10.5, color: index <= activeStep ? "var(--foreground)" : MUTED, marginTop: 4, textAlign: "center" }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {statusError && <div style={{ fontSize: 11.5, color: "var(--caution)", marginTop: 8 }}>{statusError}</div>}
            {view.tone === "attention" && (
              <Notice>This status needs your attention. SparkPoint never holds your funds.</Notice>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
