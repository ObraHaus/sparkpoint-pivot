/**
 * 049 v4.1.0 — the admin admission queue's PURE model: wire types, phase/countdown decisions, the
 * deterministic CREATE2 salt and the `createVault` argument mapping. No fetch, no React, no clock
 * read — the component injects `nowSec`, so the rules are testable and the panel cannot drift from
 * the runner (same salt, same params shape, same provenance semantics).
 *
 * Admission is on-chain RBAC (constitution v4.1.0): the AI deployer admits with a cooling-off
 * window (default 24h, bounded 1h–7d), the operator EOA admits/deploys instantly, and one wrapper
 * per child is enforced by the factory. This module only renders that state faithfully.
 */

import { keccak256, toHex } from "viem";

export type AdmissionStatus = "pending" | "deployed" | "cancelled" | "failed";
export type AdmissionPhase =
  | "not-admitted"
  | "cooling"
  | "ready"
  | "deployed"
  | "cancelled"
  | "failed";

export interface AdmissionEntry {
  id: string;
  childAddress: string;
  byAddress: string | null;
  readyAt: number;
  ready: boolean;
  feeBps: number;
  perUserCap: string;
  totalCap: string;
  vaultCap: string;
  name: string;
  symbol: string;
  label: string;
  status: AdmissionStatus;
  txHash: string | null;
  proxyAddress: string | null;
  capRegistry: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdmissionCandidate {
  childAddress: string;
  vaultLabel: string;
  assetSymbol: string | null;
  assetDecimals: number | null;
  status: "none" | AdmissionStatus;
  byAddress: string | null;
  readyAt: number | null;
  feeBps: number;
  perUserCap: string;
  totalCap: string;
  vaultCap: string;
  name: string;
  symbol: string;
  label: string;
}

export interface AdmissionData {
  entries: AdmissionEntry[];
  pending: number;
  candidates: AdmissionCandidate[];
}

/** Pill classes for the phases (`pill ok | amber | bad | info | ghosty`). */
export const ADMISSION_TONE: Record<AdmissionPhase, string> = {
  "not-admitted": "ghosty",
  cooling: "amber",
  ready: "ok",
  deployed: "ok",
  cancelled: "info",
  failed: "bad",
};

export const ADMISSION_LABEL: Record<AdmissionPhase, string> = {
  "not-admitted": "not admitted",
  cooling: "cooling off",
  ready: "ready",
  deployed: "wrapped",
  cancelled: "cancelled",
  failed: "failed",
};

export function phaseOf(
  entry: Pick<AdmissionEntry, "status" | "readyAt"> | null,
  nowSec: number,
): AdmissionPhase {
  if (entry === null) return "not-admitted";
  if (entry.status === "deployed") return "deployed";
  if (entry.status === "cancelled") return "cancelled";
  if (entry.status === "failed") return "failed";
  if (entry.readyAt === 0 || entry.readyAt <= nowSec) return "ready";
  return "cooling";
}

/** "23h 41m" / "41m 12s" / "ready now" — honest, never negative. */
export function remainingLabel(readyAt: number, nowSec: number): string {
  const s = Math.max(0, Math.floor(readyAt - nowSec));
  if (s === 0) return "ready now";
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * The CREATE2 salt the runner uses for the same child (`runners/src/shared/wrapper.ts`
 * `saltForChild`) — one formula, so an admin deploy and an AI deploy of the same child land on the
 * same predicted address and can never both exist.
 */
export function admissionSalt(childAddress: string): `0x${string}` {
  return keccak256(toHex(`sparkpoint.wrapper.v3:${childAddress.toLowerCase()}`));
}

export interface CreateVaultArgs {
  child: `0x${string}`;
  feeBps: number;
  perUserCap: bigint;
  totalCap: bigint;
  vaultCap: bigint;
  name: string;
  symbol: string;
  label: string;
  salt: `0x${string}`;
}

/** Map an entry/candidate to the factory's `CreateVaultParams` (caps as raw base units). */
export function createVaultArgs(source: AdmissionEntry | AdmissionCandidate): CreateVaultArgs {
  return {
    child: source.childAddress as `0x${string}`,
    feeBps: source.feeBps,
    perUserCap: BigInt(source.perUserCap),
    totalCap: BigInt(source.totalCap),
    vaultCap: BigInt(source.vaultCap),
    name: source.name,
    symbol: source.symbol,
    label: source.label,
    salt: admissionSalt(source.childAddress),
  };
}

/** Whole hours from on-chain seconds (the panel speaks hours; the chain speaks seconds). */
export function cooldownHours(seconds: number): number {
  return Math.round(seconds / 3600);
}

/** Hours → seconds for `setCooldown`, or null when outside the on-chain bounds [1h, 7d]. */
export function hoursToSeconds(hours: number): number | null {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) return null;
  return hours * 3600;
}

/** Rows to render: live candidates first (not-admitted/active), then deployed/cancelled history. */
export function admissionRows(data: AdmissionData): Array<
  | { kind: "candidate"; candidate: AdmissionCandidate; entry: AdmissionEntry | null }
  | { kind: "history"; entry: AdmissionEntry }
> {
  const byChild = new Map(data.entries.map((entry) => [entry.childAddress, entry]));
  const rows: Array<
    | { kind: "candidate"; candidate: AdmissionCandidate; entry: AdmissionEntry | null }
    | { kind: "history"; entry: AdmissionEntry }
  > = [];
  const live = new Set<string>();
  for (const candidate of data.candidates) {
    live.add(candidate.childAddress);
    rows.push({ kind: "candidate", candidate, entry: byChild.get(candidate.childAddress) ?? null });
  }
  for (const entry of data.entries) {
    if (live.has(entry.childAddress)) continue;
    if (entry.status === "pending") {
      // A pending entry whose curated row is no longer offered (e.g. hidden) still needs action.
      rows.push({ kind: "history", entry });
      continue;
    }
    rows.push({ kind: "history", entry });
  }
  return rows;
}
