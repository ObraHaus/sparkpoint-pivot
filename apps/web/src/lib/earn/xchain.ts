/**
 * 079 — cross-chain Rhea Phase C flags + review helpers.
 *
 * Two switches, both OFF unless exactly "true":
 *   - `NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN` shows the review entry points in the browser;
 *   - `EARN_LIVE_RHEA_XCHAIN` (server) gates the live (`dry=false`) commit route.
 *
 * Where 078 is the SAME-CHAIN NEAR → Burrow rail, this is the 071 cross-chain MCA/1Click rail:
 * an EVM origin (Base/Ethereum USDC) supplies into the user's Rhea Multichain Account via 1Click.
 * Nothing here signs or sends. A live commit only prepares an UNSIGNED origin ERC-20 transfer for
 * the user's own wallet; the agent never signs.
 */

import type { EarnQuoteBlock, EarnXchainTransferPlan } from "@sparkpoint/shared/schemas";

export const XCHAIN_FLAG_ENV = "EARN_LIVE_RHEA_XCHAIN";
export const XCHAIN_PUBLIC_FLAG_ENV = "NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN";
export const XCHAIN_PAGE_PATH = "/vault/rhea-xchain";

/** True only for the exact string "true" (case/whitespace tolerant). Anything else is off. */
export function parseXchainFlag(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

/** The build-time browser switch (Next inlines the `NEXT_PUBLIC_*` read). */
export function publicXchainEnabled(): boolean {
  return parseXchainFlag(process.env.NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN);
}

/** The server switch. Either the server or public flag may render the page. */
export function serverXchainEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    parseXchainFlag(env.EARN_LIVE_RHEA_XCHAIN) ||
    parseXchainFlag(env.NEXT_PUBLIC_EARN_LIVE_RHEA_XCHAIN)
  );
}

export interface XchainGate {
  readonly serverEnabled: boolean;
  readonly keyPresent: boolean;
  readonly liveAllowed: boolean;
  readonly reason?: string | null;
  readonly flagEnv?: string;
  readonly keyEnv?: string;
  readonly appUrl?: string;
  readonly note?: string;
  readonly origins?: readonly string[];
}

/** The gate the live button must pass: server flag AND key PRESENCE (never the key value). */
export function gateAllowsLive(gate: XchainGate | null | undefined): boolean {
  return (
    gate?.serverEnabled === true &&
    gate?.keyPresent === true &&
    gate?.liveAllowed === true
  );
}

export interface XchainReviewLink {
  readonly origin?: string | null;
  readonly vault?: string | null;
  readonly amount?: string | null;
  readonly chain?: string | null;
}

/** `/vault/rhea-xchain?…` — the single dual-access review route. Empty values are omitted. */
export function xchainReviewHref(input: XchainReviewLink = {}): string {
  const params = new URLSearchParams();
  if (input.chain) params.set("chain", input.chain);
  if (input.origin) params.set("origin", input.origin);
  if (input.vault) params.set("vault", input.vault);
  if (input.amount) params.set("amount", input.amount);
  const query = params.toString();
  return query ? `${XCHAIN_PAGE_PATH}?${query}` : XCHAIN_PAGE_PATH;
}

const ORIGIN_LABELS: Record<string, string> = {
  "base:USDC": "Base USDC",
  "eth:USDC": "Ethereum USDC",
  "sol:USDC": "Solana USDC",
};

export function originLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return ORIGIN_LABELS[key] ?? key;
}

/**
 * Validate an origin USDC amount in the browser before calling the agent. Accepts a plain
 * positive decimal with at most `decimals` places; returns the trimmed text or `null`. The agent
 * re-validates, so this is UX only — never a security boundary.
 */
export function parseXchainAmount(
  raw: string | null | undefined,
  decimals = 6,
): string | null {
  const text = (raw ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const fraction = text.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  return text;
}

export interface ReviewLine {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly tone?: "caution" | "gain";
}

/**
 * The review rows the UI must show before any wallet action: origin chain/asset/amount, refund,
 * MCA/recipient message and fees. PURE so it is unit-tested without a browser.
 */
export function xchainReviewLines(
  block: EarnQuoteBlock,
  wallet: string | null | undefined,
): ReviewLine[] {
  const lines: ReviewLine[] = [
    {
      key: "origin",
      label: "Origin",
      value: `${block.amountIn ?? block.origin?.amount ?? "—"} ${
        block.origin?.symbol ?? "USDC"
      } on ${block.origin?.chainLabel ?? block.origin?.chain ?? "—"}`,
    },
    {
      key: "refund",
      label: "Refund address",
      value: wallet ?? "Connect the origin wallet",
    },
    {
      key: "recipient",
      label: block.firstDeposit ? "Rhea account (created on first deposit)" : "Your Rhea account",
      value: block.recipient ?? "—",
    },
  ];
  if (block.netSupplied) {
    lines.push({
      key: "net",
      label: "Net supplied",
      value: `≈ ${block.netSupplied} USDC`,
    });
  }
  if (block.oneTimeFee) {
    lines.push({
      key: "fee",
      label: "One-time Rhea account fee",
      value: `${block.oneTimeFee.amount} ${block.oneTimeFee.symbol} (${block.oneTimeFee.reason})`,
      tone: "caution",
    });
  }
  if (block.feeNote) {
    lines.push({ key: "routing-fee", label: "Routing fee", value: block.feeNote, tone: "caution" });
  }
  if (block.depositAddress) {
    lines.push({
      key: "deposit",
      label: "1Click deposit address",
      value: block.depositAddress,
      tone: "gain",
    });
  }
  return lines;
}

/** The one-line wallet confirmation summary for an UNSIGNED transfer plan. */
export function transferPlanLine(plan: EarnXchainTransferPlan | null | undefined): string {
  if (!plan) return "No transfer plan yet.";
  if (plan.kind === "unsupported") return plan.note;
  return `transfer(${plan.to}, ${plan.amountRaw}) on ${plan.symbol} ${plan.chain} — unsigned`;
}

/** A transfer plan is only offerable when it is a real, unsigned ERC-20 transfer. */
export function planIsOfferable(plan: EarnXchainTransferPlan | null | undefined): boolean {
  return (
    plan?.kind === "erc20_transfer" &&
    plan.unsigned === true &&
    !!plan.to &&
    /^0x[0-9a-fA-F]{40}$/.test(plan.tokenAddress ?? "") &&
    !!plan.calldata &&
    /^0x[0-9a-fA-F]*$/.test(plan.calldata)
  );
}

/** The wallet the plan was prepared for must be the connected signer (case-insensitive). */
export function planSignerMatches(
  plan: EarnXchainTransferPlan | null | undefined,
  connected: string | null | undefined,
): boolean {
  if (!plan?.from || !connected) return false;
  return plan.from.toLowerCase() === connected.toLowerCase();
}
