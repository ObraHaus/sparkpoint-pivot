/**
 * The SINGLE source of user-visible product-stage copy (R5 A4).
 *
 * The app's launch stage — alpha (now, testnet), beta, or prod — is read from one flag
 * (`NEXT_PUBLIC_APP_STAGE` via {@link env}) and mapped to every stage word the UI shows. Nothing
 * here gates access: the server-anchored beta allowlist ("beta" role / session claim /
 * BETA_NOT_ENABLED) is a SEPARATE, unrelated identifier and must never be renamed to match this.
 *
 * Import `stage`, `stageCopy`, or the copy fields instead of hardcoding "beta"/"alpha"/"develop"
 * strings anywhere in the UI.
 */

import { env } from "@/lib/env";

export type Stage = "alpha" | "beta" | "prod";

export const stage: Stage = env.appStage;

interface StageCopy {
  /** Short badge label, e.g. "Alpha". */
  label: string;
  /** Longer descriptor, e.g. "Alpha — testnet". */
  long: string;
  /** Deposit-cap noun, e.g. "alpha cap". */
  capNoun: string;
  /** Access-gate noun, e.g. "private alpha". */
  gateNoun: string;
  /** Adjective for prose, e.g. "alpha". */
  adjective: string;
}

const COPY: Record<Stage, StageCopy> = {
  alpha: {
    label: "Alpha",
    // Multi-network testnet (Base Sepolia + Robinhood Chain Testnet) — not chain-specific, so the
    // badge no longer names a single chain (which read as "only Base Sepolia is supported").
    long: "Alpha — testnet",
    capNoun: "alpha cap",
    gateNoun: "private alpha",
    adjective: "alpha",
  },
  beta: {
    label: "Beta",
    long: "Beta — Robinhood Chain",
    capNoun: "beta cap",
    gateNoun: "private beta",
    adjective: "beta",
  },
  prod: {
    label: "Live",
    long: "Live",
    capNoun: "deposit cap",
    gateNoun: "early access",
    adjective: "launch",
  },
};

export const stageCopy: StageCopy = COPY[stage];

/** Convenience exports for the most-used fields (so callers can `import { stageLabel }`). */
export const stageLabel = stageCopy.label;
export const stageLong = stageCopy.long;
export const capNoun = stageCopy.capNoun;
export const gateNoun = stageCopy.gateNoun;
