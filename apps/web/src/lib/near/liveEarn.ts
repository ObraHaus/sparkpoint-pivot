/**
 * 078 — flags and review-surface rules for the Rhea same-chain live earn rail.
 *
 * Two switches, both OFF unless exactly "true":
 *   - `NEXT_PUBLIC_EARN_LIVE_RHEA` shows the /vault/live entry points in the browser;
 *   - `EARN_LIVE_RHEA` (server) gates the preflight + receipt routes. The client cannot conjure a
 *     plan when the server flag is off: the API returns 404.
 *
 * Nothing here signs or sends. The confirm step is the only place that calls the wallet transaction
 * capability, and it is reachable only after an explicit review acknowledgement.
 */

import {
  BURROW_CONTRACT,
  RHEA_APP_URL,
  USDC_TOKEN_ID,
  formatUsdc,
  planIsFresh,
  refusedWalletSwitch,
} from "./burrow.ts";

export function parseLiveFlag(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

/** Build-time switch for the browser entry points (Next inlines the NEXT_PUBLIC_ read). */
export function publicLiveRheaEnabled(): boolean {
  return parseLiveFlag(process.env.NEXT_PUBLIC_EARN_LIVE_RHEA);
}

/** Server switch for the preflight/receipt routes. Never used to authorise a signature. */
export function serverLiveRheaEnabled(): boolean {
  return parseLiveFlag(process.env.EARN_LIVE_RHEA);
}

export const RHEA_LIVE_ENV_NAMES = ["EARN_LIVE_RHEA", "NEXT_PUBLIC_EARN_LIVE_RHEA"] as const;

export const RHEA_LIVE_MARKET = {
  protocol: "rhea",
  chain: "near",
  contract: BURROW_CONTRACT,
  token: USDC_TOKEN_ID,
  symbol: "USDC",
  appUrl: RHEA_APP_URL,
} as const;

export type LiveEarnAction = "supply" | "withdraw";

export interface ReviewAck {
  readonly acknowledged: boolean;
  readonly checkedAtMs: number;
  readonly expectedAccountId: string;
  readonly currentAccountId: string | null;
  readonly nowMs?: number;
}

export type ConfirmBlocker =
  | "not_acknowledged"
  | "stale_plan"
  | "wallet_switch"
  | "no_account";

/** The exact gate the confirm button must pass. Any failure means no wallet call. */
export function confirmBlocker(input: ReviewAck): ConfirmBlocker | null {
  if (!input.acknowledged) return "not_acknowledged";
  if (!input.expectedAccountId) return "no_account";
  if (!planIsFresh(input.checkedAtMs, input.nowMs ?? Date.now())) return "stale_plan";
  if (refusedWalletSwitch(input.expectedAccountId, input.currentAccountId)) return "wallet_switch";
  return null;
}

export function confirmBlockerCopy(blocker: ConfirmBlocker): string {
  switch (blocker) {
    case "not_acknowledged":
      return "Tick the confirmation box after reading the review. Nothing is signed until you do.";
    case "stale_plan":
      return "This review is more than 60 seconds old. Rebuild the plan so balances and gas are current.";
    case "wallet_switch":
      return "The connected NEAR account changed. Refusing to send — review again with the intended account.";
    case "no_account":
      return "Connect the NEAR wallet that should sign this transaction.";
  }
}

export interface ReviewLine {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly tone?: "caution" | "gain";
}

export interface PreflightReview {
  readonly action: LiveEarnAction;
  readonly accountId: string;
  readonly amount: string;
  readonly amountRaw: string;
  readonly tokenBalance: string;
  readonly nearBalance: string;
  readonly nearRequired: string;
  readonly supplied: string | null;
  readonly storage: {
    readonly registersBurrowAccount: boolean;
    readonly registersTokenReceiver: boolean;
    readonly totalNear: string;
  };
  readonly contract: string;
  readonly token: string;
  readonly blockHeight: number;
  readonly blockHash: string;
  readonly checkedAtMs: number;
}

export function reviewLines(review: PreflightReview): ReviewLine[] {
  const lines: ReviewLine[] = [
    { key: "action", label: "Action", value: review.action === "supply" ? "Supply USDC to Burrow/Rhea" : "Withdraw USDC from Burrow/Rhea" },
    { key: "amount", label: "Amount", value: `${review.amount} USDC` },
    { key: "account", label: "Signing NEAR account", value: review.accountId },
    { key: "contract", label: "Burrow contract", value: review.contract },
    { key: "token", label: "Token (NEP-141)", value: review.token },
    { key: "token-balance", label: "Wallet USDC balance", value: `${review.tokenBalance} USDC` },
    {
      key: "near-balance",
      label: "Wallet NEAR (gas + storage)",
      value: `${review.nearBalance} NEAR (needs ${review.nearRequired})`,
    },
  ];
  if (review.action === "withdraw" && review.supplied) {
    lines.push({ key: "supplied", label: "Currently supplied", value: `${review.supplied} USDC` });
  }
  if (review.storage.totalNear !== "0") {
    lines.push({
      key: "storage",
      label: "One-time storage deposits",
      value: `${review.storage.totalNear} NEAR${
        review.storage.registersBurrowAccount ? " · registers your Burrow account" : ""
      }${review.storage.registersTokenReceiver ? " · registers the token receiver" : ""}`,
      tone: "caution",
    });
  }
  lines.push({
    key: "freshness",
    label: "Plan block",
    value: `${review.blockHeight} · ${review.blockHash.slice(0, 10)}…`,
  });
  return lines;
}

/** Convert plan yoctoNEAR to a short NEAR string for the review screen. */
export function formatNearYocto(yocto: string | bigint): string {
  const value = typeof yocto === "bigint" ? yocto : BigInt(yocto);
  const whole = value / 10n ** 24n;
  const fraction = (value % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction.slice(0, 6)}` : ""}`;
}

export function formatUsdcForReview(raw: string | bigint): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  return formatUsdc(value);
}
