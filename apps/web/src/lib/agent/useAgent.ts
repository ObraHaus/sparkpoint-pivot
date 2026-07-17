"use client";

/**
 * useAgent — the React seam that binds the mock screens to the live Hermes agent
 * service (T070/T075/T081/T082). It resolves a per-user {@link AgentIdentity} from
 * wagmi and constructs a memoized {@link AgentClient} that targets the same-origin
 * BFF (`/api/agent`) by default — the server-side route handler injects the bearer
 * and forwards to the agent, so NO token/agent-URL lives in the client bundle. It
 * exposes react-query reads + streaming drivers for the four surfaces.
 *
 * GRACEFUL OFFLINE (non-custody law): when no wallet is connected, every hook
 * reports `online === false` and returns `null` data. The BFF is same-origin and
 * always reachable, so "online" no longer needs a configured base URL; if the
 * agent itself is down the BFF returns a §1.5 error envelope that surfaces as an
 * error card. Callers keep rendering the existing mock UI — NEVER a crash, never a
 * blocked withdraw/exit path. The agent is advisory: these hooks only READ and
 * PROPOSE; the client itself fail-closes any signature (N1/N3), and nothing here
 * makes a block signable — that stays `cards.isSignable` (policy.status="approved").
 *
 * Grounding: agent-service-api.md §3.1 (/onboarding/turn, /mandate), §3.2 (/chat),
 * §3.3 (/portfolio), §3.4 (/recommendations); tasks.md T070/T075/T081/T082.
 */

import { useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";

import { createAgentClient, type AgentClient, type AgentIdentity } from "@/lib/agent/client";

/** Base mainnet chain id — the identity fallback when wagmi has no chain yet. */
const DEFAULT_CHAIN_ID = 8453;

/* ── identity + client ─────────────────────────────────────────────────────── */

/**
 * The live agent identity (§1.2), derived from the connected wallet. In this build
 * there is no smart-account derivation, so the connected EOA is used for BOTH the
 * `X-Account` anchor and the `X-Owner` signer. `null` until a wallet is connected.
 */
export function useAgentIdentity(): AgentIdentity | null {
  const { address, chainId } = useAccount();
  return useMemo<AgentIdentity | null>(() => {
    if (!address) return null;
    // Identity ONLY — no bearer. The same-origin BFF (`/api/agent`) injects the
    // service token server-side, so the browser never holds a credential (§1.2).
    return { account: address, owner: address, chainId: chainId ?? DEFAULT_CHAIN_ID };
  }, [address, chainId]);
}

export interface AgentConnection {
  /** The memoized client, or `null` when no wallet identity is resolved yet. */
  client: AgentClient | null;
  /** `true` iff a wallet identity is resolved (the BFF is always same-origin reachable). */
  online: boolean;
  identity: AgentIdentity | null;
}

/**
 * Resolve the agent client for the current identity. The client targets the
 * same-origin BFF (`/api/agent`) — there is no client-side base-URL override. Returns
 * `client: null` (and
 * `online: false`) until a wallet is connected — the signal every surface uses to
 * fall back to its mock rendering. An agent that is down does NOT read as offline
 * here: the call still fires and the BFF's error envelope surfaces as an error card.
 */
export function useAgentClient(): AgentConnection {
  const identity = useAgentIdentity();
  const client = useMemo<AgentClient | null>(() => {
    if (!identity) return null;
    // Always the same-origin BFF (`/api/agent`) — no client-side base-URL override exists.
    return createAgentClient({ identity });
  }, [identity]);
  return { client, online: client !== null, identity };
}

/* ── small parse helpers (defensive; the wire is validated fail-closed elsewhere) ─ */

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/* ── GET /portfolio (§3.3) ─────────────────────────────────────────────────── */

interface PortfolioPositionDto {
  positionId?: string;
  costBasisUsd?: string | null;
  unrealizedPnlUsd?: string | null;
}

interface PortfolioResponse {
  netWorthUsd?: string;
  stale?: boolean;
  positions?: PortfolioPositionDto[];
  pnl?: {
    series?: { ts?: string; valueUsd?: string }[];
    realizedUsd?: string | null;
    unrealizedUsd?: string | null;
  };
}

/** Per-position derived figures from the §B2 on-chain flow index. `undefined` ⇒ not indexed yet. */
export interface PositionPnl {
  costBasisUsd?: number;
  unrealizedPnlUsd?: number;
}

/**
 * A DISPLAY view over `GET /portfolio`, mapped into the exact values the mock
 * portfolio screen already consumes (`netWorth`, `series`, `pnl`). Every field is
 * OPTIONAL: the screen fills any gap from mock data via `??`, so a partial/stale
 * response degrades gracefully instead of blanking the UI. `null` ⇒ offline (all
 * mock). The custody-critical balances stay on direct RPC (`useVault`), never here —
 * only the DERIVED, non-custody figures (cost basis + unrealized PnL, §B2) come from here.
 */
export interface PortfolioView {
  netWorth?: number;
  series?: number[];
  pnl?: { abs: number; pct: number };
  /** Aggregate unrealized PnL in USD (indexed cost basis vs current value); `undefined` if unindexed. */
  unrealizedUsd?: number;
  /** Per-position cost basis + unrealized PnL, keyed by positionId (e.g. `"vault"`). */
  positionPnl: Record<string, PositionPnl>;
  /** Timestamped position-value history for the net-worth chart (`t` = ms epoch, `v` = USD).
   * Real, derived from the indexed flows; empty when nothing is indexed (honest — never mock). */
  history: { t: number; v: number }[];
  stale: boolean;
}

export function usePortfolioView(): PortfolioView | null {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "portfolio", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => client!.request<PortfolioResponse>("/portfolio", { signal }),
  });

  if (!online) return null;
  const d = query.data;
  if (!d) return null;

  const netWorth = numeric(d.netWorthUsd);
  const rawSeries = Array.isArray(d.pnl?.series)
    ? d.pnl!.series.map((p) => numeric(p?.valueUsd)).filter((n): n is number => n !== undefined)
    : undefined;
  const series = rawSeries && rawSeries.length >= 2 ? rawSeries : undefined;

  let pnl: { abs: number; pct: number } | undefined;
  if (series) {
    const first = series[0];
    const last = series[series.length - 1];
    const abs = last - first;
    const pct = first > 0 ? Math.round((abs / first) * 10000) / 100 : 0;
    pnl = { abs: Math.round(abs * 100) / 100, pct };
  }

  // Timestamped value history (for the net-worth chart + range selector).
  const history = Array.isArray(d.pnl?.series)
    ? d.pnl!.series
        .map((p) => ({ t: Date.parse(p?.ts ?? ""), v: numeric(p?.valueUsd) }))
        .filter((p): p is { t: number; v: number } => !Number.isNaN(p.t) && p.v !== undefined)
    : [];

  // §B2 derived figures. `numeric(null)` ⇒ undefined, so an unindexed value stays "pending".
  const unrealizedUsd = numeric(d.pnl?.unrealizedUsd);
  const positionPnl: Record<string, PositionPnl> = {};
  for (const p of d.positions ?? []) {
    if (!p?.positionId) continue;
    positionPnl[p.positionId] = {
      costBasisUsd: numeric(p.costBasisUsd),
      unrealizedPnlUsd: numeric(p.unrealizedPnlUsd),
    };
  }

  return { netWorth, series, pnl, unrealizedUsd, positionPnl, history, stale: d.stale === true };
}

/* ── GET /portfolio/positions/{id} — transaction history (§tx) ─────────────── */

/** One indexed Deposit/Withdraw row for the transaction list. `tsApprox` is an ESTIMATE from block
 * height (Base ~2s blocks) — surfaced as approximate; `blockNumber`/`txHash` are exact. */
export interface PositionTx {
  kind: "deposit" | "withdraw";
  amountUsd: string;
  shares: string;
  blockNumber: number;
  txHash: `0x${string}`;
  tsApprox: string;
}

interface PositionEventsResponse {
  stale?: boolean;
  onchainEvents?: PositionTx[];
}

export interface PositionTxView {
  /** The indexed rows (empty only when the load SUCCEEDED with nothing indexed — see `loaded`). */
  txs: PositionTx[];
  stale: boolean;
  /** The fetch is in flight (distinguish from a confirmed-empty history). */
  isLoading: boolean;
  /** The fetch failed (distinguish from a confirmed-empty history). */
  isError: boolean;
  /** A response was received (so `txs.length === 0` means genuinely no transactions). */
  loaded: boolean;
  refetch: () => void;
}

/**
 * The vault position's on-chain transaction history (indexed Deposit/Withdraw, newest first). `null`
 * when offline. A confirmed-empty history (`loaded && txs.length === 0`) is distinct from a
 * still-loading or failed fetch — the UI must not label the latter "no transactions".
 */
export function usePositionTransactions(): PositionTxView | null {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "position-tx", "vault", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) =>
      client!.request<PositionEventsResponse>("/portfolio/positions/vault", { signal }),
  });
  if (!online) return null;
  const d = query.data;
  const txs = Array.isArray(d?.onchainEvents) ? d!.onchainEvents : [];
  return {
    txs,
    stale: d?.stale === true,
    isLoading: query.isLoading,
    isError: query.isError,
    loaded: query.isSuccess && d !== undefined,
    refetch: () => void query.refetch(),
  };
}

/* ── GET /recommendations (§3.4) ───────────────────────────────────────────── */

interface RecommendationDto {
  recId?: string;
  rank?: number;
  title?: string;
  rationale?: string;
  protocol?: string;
  projectedApyBps?: number;
  grossApyBps?: number;
  performanceFeeBps?: number;
  policy?: { status?: string };
}

interface RecommendationsResponse {
  recommendations?: RecommendationDto[];
  stale?: boolean;
}

/**
 * One ranked strategy card, mapped into the shape the mock strategies screen
 * renders. `signable` mirrors `cards.isSignable` (policy `approved`) — it is the
 * SOLE gate on the actionable "Review this move" affordance; a rejected/unknown
 * rec renders inert (the non-actionable branch), never a sign path.
 */
export interface RecView {
  id: string;
  rankLabel: string;
  title: string;
  thesis: string;
  /** Net (projected) APY %, 0 ⇒ rendered as "no yield (cash)". */
  apy: number;
  /** Risk tier for the RiskChip (only the lower-risk Aave vault is live today). */
  risk: number;
  fit: string;
  signable: boolean;
  best: boolean;
}

export function useRecommendationsView(): RecView[] | null {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "recommendations", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) =>
      client!.request<RecommendationsResponse>("/recommendations?limit=5", { signal }),
  });

  if (!online) return null;
  const recs = query.data?.recommendations;
  if (!Array.isArray(recs)) return null;

  return recs.map((r, i): RecView => {
    const isTop = r.rank === 1 || i === 0;
    return {
      id: r.recId ?? `rec_${i}`,
      rankLabel: isTop ? "Best fit · #1 vs your goal" : `#${r.rank ?? i + 1} vs your goal`,
      title: r.title ?? "Strategy",
      thesis: r.rationale ?? "",
      apy: typeof r.projectedApyBps === "number" ? r.projectedApyBps / 100 : 0,
      risk: 1,
      fit: isTop ? "Fits your plan: lower risk, steady yield." : "Conservative, capital-preservation-first.",
      // Non-custody: signable ⟺ the deterministic policy approved it (§2.7).
      signable: r.policy?.status === "approved",
      best: i === 0,
    };
  });
}

/* ── POST /onboarding/turn + POST /mandate (§3.1) ──────────────────────────── */

/** The confirmed-mandate body (§3.1 `mandate_draft`), assembled from onboarding answers. */
export interface MandateDraft {
  goals: { kind: string; label: string }[];
  riskProfile: string;
  riskParams: { maxSlippageBps: number; drawdownTolerance: string; horizonMonths: number };
  summaryText: string;
  version: number;
}

export interface OnboardingDriver {
  online: boolean;
  /**
   * Drive `POST /onboarding/turn` for the terminal `review` step and return the
   * server's `mandate_draft` mandate if it streamed one, else `null`. Best-effort:
   * any failure (incl. the not-yet-deployed backend) resolves `null` so the local
   * draft is used instead. NEVER throws, never blocks navigation.
   */
  runReview: (draft: MandateDraft, selections: Record<string, unknown>) => Promise<MandateDraft | null>;
  /**
   * Persist a confirmed mandate via `POST /mandate` (FR-002). Best-effort; resolves
   * `null` on any error. The mandate is advisory config — it never authorizes funds.
   */
  confirmMandate: (mandate: MandateDraft) => Promise<unknown | null>;
}

export function useOnboarding(): OnboardingDriver {
  const { client, online, identity } = useAgentClient();

  const runReview = useCallback(
    async (draft: MandateDraft, selections: Record<string, unknown>): Promise<MandateDraft | null> => {
      if (!client) return null;
      try {
        const gen = client.stream("/onboarding/turn", {
          step: "review",
          userMessage: "",
          selections,
        });
        let serverDraft: MandateDraft | null = null;
        for (;;) {
          const res = await gen.next();
          if (res.done) break;
          try {
            const parsed = JSON.parse(res.value) as { type?: string; mandate?: MandateDraft };
            if (parsed?.type === "mandate_draft" && parsed.mandate) serverDraft = parsed.mandate;
          } catch {
            // ignore non-JSON / non-mandate frames — advisory drive only.
          }
        }
        return serverDraft;
      } catch {
        return null;
      }
    },
    [client],
  );

  const confirmMandate = useCallback(
    async (mandate: MandateDraft): Promise<unknown | null> => {
      if (!client) return null;
      try {
        const res = await client.request<{ mandate?: unknown }>("/mandate", {
          method: "POST",
          body: { mandate },
          // Caller-owned, stable per user+version so a retry de-dupes (§1.3).
          idempotencyKey: `mandate-${identity?.account ?? "anon"}-v${mandate.version}`,
        });
        return res?.mandate ?? null;
      } catch {
        return null;
      }
    },
    [client, identity],
  );

  return { online, runReview, confirmMandate };
}
