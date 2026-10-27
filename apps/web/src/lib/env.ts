/**
 * Typed, validated PUBLIC runtime config (T030 — web half).
 *
 * Loads the `NEXT_PUBLIC_*` vars the web app actually uses, validates them with
 * zod, and exposes a single frozen, typed `env` object. Every field is
 * fail-soft: a missing or malformed value falls back to a safe default so this
 * loader can NEVER throw at import time and NEVER block a render (non-custody
 * law — nothing here may sit on, or break, the withdraw/exit path).
 *
 * CLIENT-SAFETY INVARIANT: this module reads ONLY `NEXT_PUBLIC_*` vars, referenced
 * as literal `process.env.NEXT_PUBLIC_…` member expressions so Next.js can inline
 * them into the client bundle. It ASSERTS at module init that no non-public or
 * secret/private-key-shaped var is ever read here — a private key, mnemonic, or
 * API secret must never reach the browser (the app is non-custodial; the user is
 * the sole signer). See {@link assertPublicOnly}.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T030 (assert no secrets are
 * read/persisted client-side); wagmi/chain seams that consume the RPC urls.
 */

import { z } from "zod/v3";

/** Canonical public RPC endpoints — safe fallbacks when the env var is unset/invalid. */
const BASE_RPC_FALLBACK = "https://mainnet.base.org";
const BASE_SEPOLIA_RPC_FALLBACK = "https://sepolia.base.org";

/**
 * The raw reads. MUST be literal `process.env.NEXT_PUBLIC_…` member expressions
 * (not dynamic `process.env[key]`) so Next.js statically inlines them client-side.
 */
const RAW = {
  NEXT_PUBLIC_BASE_RPC_URL: process.env.NEXT_PUBLIC_BASE_RPC_URL,
  NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  // Product STAGE — the single source for user-visible stage wording (alpha/beta/prod). This is a
  // presentation flag ONLY; it never gates access (that's the server-anchored beta allowlist).
  NEXT_PUBLIC_APP_STAGE: process.env.NEXT_PUBLIC_APP_STAGE,
  // Feature 006 — force-refresh kill-switch. Ships OFF; the auto-reload is enabled only after the
  // US2 safety nets are verified. Behaviour flag ONLY — never gates funds or the withdraw/exit path.
  NEXT_PUBLIC_FORCE_REFRESH: process.env.NEXT_PUBLIC_FORCE_REFRESH,
  // NOTE: there is deliberately NO client-side agent base-URL override. The browser ALWAYS
  // calls the same-origin BFF (`/api/agent`), which injects the service bearer server-side —
  // a `NEXT_PUBLIC_AGENT_BASE_URL` would let a deploy redirect user-scoped calls straight to
  // the agent (leaking wallet-address headers + bypassing the BFF), so it was removed.
} as const;

/** Names that would signal a secret leaking into the client bundle. */
const SECRET_SHAPED =
  /(PRIVATE_KEY|PRIVKEY|MNEMONIC|SEED_PHRASE|SECRET|SIGNING_KEY|API_KEY|APIKEY|PASSWORD|_SK$|_TOKEN$)/i;

/**
 * Fail-fast dev guard: every var this module reads must be `NEXT_PUBLIC_*` and
 * must not be secret-shaped. Because the key set above is a compile-time literal
 * of only public, non-secret names, this can only ever fire if a future edit
 * adds a client-side read of a private var — exactly what we want to forbid.
 */
function assertPublicOnly(keys: readonly string[]): void {
  for (const key of keys) {
    if (!key.startsWith("NEXT_PUBLIC_")) {
      throw new Error(
        `env: refusing to read non-public var "${key}" on the client — only NEXT_PUBLIC_* is permitted.`,
      );
    }
    if (SECRET_SHAPED.test(key)) {
      throw new Error(`env: "${key}" is secret/key-shaped and must never be read client-side.`);
    }
  }
}
assertPublicOnly(Object.keys(RAW));

/**
 * Schema for the public config. `.default()` covers the unset case and `.catch()`
 * the malformed case, so parsing is total (never throws) — a typo degrades to a
 * safe fallback instead of bricking the client.
 */
const EnvSchema = z.object({
  /** Base mainnet (8453) RPC. Falls back to the canonical public endpoint. */
  baseRpcUrl: z.string().url().default(BASE_RPC_FALLBACK).catch(BASE_RPC_FALLBACK),
  /** Base Sepolia (84532) RPC. Falls back to the canonical public endpoint. */
  baseSepoliaRpcUrl: z.string().url().default(BASE_SEPOLIA_RPC_FALLBACK).catch(BASE_SEPOLIA_RPC_FALLBACK),
  /** WalletConnect project id. `undefined` ⇒ WalletConnect not configured (feature off). */
  walletConnectProjectId: z.string().min(1).optional().catch(undefined),
  /** Product stage — the SINGLE source of user-visible stage copy. Defaults to `alpha`. */
  appStage: z.enum(["alpha", "beta", "prod"]).default("alpha").catch("alpha"),
  /** Force-refresh feature flag (feature 006). Default OFF; only `"true"` enables the auto-reload. */
  forceRefresh: z.preprocess((v) => v === "true", z.boolean()).catch(false),
});

/** The validated public config shape. */
export type Env = z.infer<typeof EnvSchema>;

/**
 * The validated, frozen public config. Import this instead of touching
 * `process.env` directly so every consumer shares one typed, defaulted view.
 */
export const env: Env = Object.freeze(
  EnvSchema.parse({
    baseRpcUrl: RAW.NEXT_PUBLIC_BASE_RPC_URL,
    baseSepoliaRpcUrl: RAW.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL,
    walletConnectProjectId: RAW.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    appStage: RAW.NEXT_PUBLIC_APP_STAGE,
    forceRefresh: RAW.NEXT_PUBLIC_FORCE_REFRESH,
  }),
);
