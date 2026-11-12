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

import { useCallback, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useSession } from "@/lib/auth/useSiwe";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { createAgentClient, AgentApiError, type AgentClient, type AgentIdentity } from "@/lib/agent/client";
import { mandateView, mandateSummary, mandateDrift, driftLabel, type MandateView, type MandateWire, type DriftStatus } from "@/lib/agent/mandate";
import { classifyMandateSaveError, type MandateSaveOutcome } from "@/lib/agent/mandateSave";
import { toRecView, type RecView, type RecommendationDto } from "@/lib/agent/recView";
import { strategiesNavVisible } from "@/lib/strategies/navVisibility";
import { toPortfolioPnl, type PositionPnl } from "@/lib/agent/portfolioPnl";
import { resolveAgentConnection, resolveAgentIdentity } from "@/lib/agent/identity";
import { PortfolioOverviewBlockSchema, type PortfolioOverviewBlock } from "@sparkpoint/shared/schemas";
import {
  toOutcomesView,
  toOutcomeDetailView,
  type OutcomesResponseDto,
  type OutcomesView,
  type RecommendationOutcomeDetailDto,
  type RecommendationOutcomeDetailView,
} from "@/lib/agent/outcomesView";
import {
  toNotificationsView,
  type NotificationsResponseDto,
  type NotificationsView,
} from "@/lib/agent/notificationsView";
import {
  toMemoryView,
  type MemoryResponseDto,
  type MemoryView,
} from "@/lib/agent/memoryView";

/** Base mainnet chain id — the identity fallback when wagmi has no chain yet. */

/* ── identity + client ─────────────────────────────────────────────────────── */

/**
 * The live agent identity (§1.2), derived from the connected wallet. In this build
 * there is no smart-account derivation, so the connected EOA is used for BOTH the
 * `X-Account` anchor and the `X-Owner` signer. `null` until a wallet is connected.
 */
export function useAgentIdentity(): AgentIdentity | null {
  const { address, chainId } = useAccount();
  // 076 — a NEAR-only session has no wagmi account. The BFF derives identity from the verified
  // session anyway; this keeps the client hooks "online" and gives them a stable query key.
  const { session } = useSession();
  // Identity ONLY — no bearer. The same-origin BFF (`/api/agent`) injects the service token
  // server-side, so the browser never holds a credential (§1.2). The mapper also covers a
  // server-verified NEAR session (no wagmi account) and the 029 NaN-chain guard.
  return useMemo<AgentIdentity | null>(
    () => resolveAgentIdentity(address, chainId, session),
    [address, chainId, session],
  );
}

export interface AgentConnection {
  /** The memoized client, or `null` when no wallet identity is resolved yet. */
  client: AgentClient | null;
  /** `true` iff a wallet identity is resolved (the BFF is always same-origin reachable). */
  online: boolean;
  identity: AgentIdentity | null;
  /**
   * The server session is still being fetched and no EVM wallet is connected. Consumers must
   * show a neutral loading state — NOT the signed-out "Demo mode"/preview — until this is false.
   */
  loading: boolean;
}

/**
 * Resolve the agent client for the current identity. The client targets the
 * same-origin BFF (`/api/agent`) — there is no client-side base-URL override. Returns
 * `client: null` (and
 * `online: false`) until a wallet identity is connected — the signal every surface uses to
 * fall back to its mock rendering. An agent that is down does NOT read as offline
 * here: the call still fires and the BFF's error envelope surfaces as an error card.
 */
export function useAgentClient(): AgentConnection {
  const { address, chainId } = useAccount();
  const { session } = useSession();
  const { loading, identity } = useMemo(
    () => resolveAgentConnection(address, chainId, session),
    [address, chainId, session],
  );
  const client = useMemo<AgentClient | null>(() => {
    if (!identity) return null;
    // Always the same-origin BFF (`/api/agent`) — no client-side base-URL override exists.
    return createAgentClient({ identity });
  }, [identity]);
  return { client, online: client !== null, identity, loading };
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
  realizedPnlUsd?: string | null;
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

/** Per-position derived figures from the §B2 on-chain flow index (`undefined` ⇒ not indexed yet).
 * The shape + pure mapping live in `portfolioPnl.ts` (dependency-free, unit-tested). */
export type { PositionPnl };

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
  /** Aggregate REALIZED PnL in USD (Σ gains on past withdrawals, §017); `undefined` if unindexed. */
  realizedUsd?: number;
  /** Per-position cost basis + realized/unrealized PnL, keyed by positionId (e.g. `"vault"`). */
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
    // Retry a transient 401 (identity exists before the SIWE session cookie does on first mount).
    retry: 2,
    queryFn: ({ signal }) => client!.request<PortfolioResponse>("/portfolio", { signal }),
  });

  if (!online) return null;
  const d = query.data;
  if (!d) return null;

  const netWorth = numeric(d.netWorthUsd);
  // Derived PnL (series/history/realized/unrealized/per-position) via the pure, unit-tested mapper.
  const v = toPortfolioPnl(d.pnl, d.positions);
  return {
    netWorth,
    series: v.series,
    pnl: v.pnl,
    unrealizedUsd: v.unrealizedUsd,
    realizedUsd: v.realizedUsd,
    positionPnl: v.positionPnl,
    history: v.history,
    stale: d.stale === true,
  };
}

/* ── 072 — GET /portfolio/multichain (read-only, session wallet only) ──────── */

/** The loading/error/data surface the Portfolio screen's "Across chains" panel renders. */
export interface MultichainPortfolioState {
  /** The validated block, or `null` until the first successful read. */
  block: PortfolioOverviewBlock | null;
  loading: boolean;
  error: string | null;
  /** `true` iff a wallet identity exists (the BFF is always same-origin reachable). */
  online: boolean;
  refetch: () => void;
}

/**
 * Read the signed-in wallet's multi-chain portfolio. The BFF derives the owner from the SIWE
 * session, so no wallet/address parameter is ever sent (the agent rejects one). The response is
 * validated fail-closed against the same shared schema the chat block uses.
 */
export function useMultichainPortfolio(
  options: { enabled?: boolean } = {},
): MultichainPortfolioState {
  const { client, online, identity, loading: sessionLoading } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "portfolio", "multichain", identity?.account, identity?.chainId],
    enabled: online && options.enabled !== false,
    staleTime: 30_000,
    retry: 2,
    queryFn: async ({ signal }) => {
      const raw = await client!.request<unknown>("/portfolio/multichain", { signal });
      const parsed = PortfolioOverviewBlockSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error("The multi-chain portfolio response couldn't be verified.");
      }
      return parsed.data;
    },
  });

  return {
    block: query.data ?? null,
    // While the session is still resolving we are neither offline nor loading real data — but a
    // neutral loading state is the honest render (never the signed-out connect prompt).
    loading: sessionLoading || (online && query.isLoading),
    error: query.error ? query.error.message : null,
    online,
    refetch: () => void query.refetch(),
  };
}

/**
 * The signed-in EVM wallet's Rhea Multichain Account (MCA) on NEAR, or `null`.
 *
 * This reuses the SAME `/portfolio/multichain` read that powers the "Across chains" panel, so the
 * vault card and Sparky's portfolio can never resolve a different Rhea account. The agent derives
 * the owner from the SIWE session; the browser supplies no address. `enabled` lets a caller skip
 * the read when a direct NEAR wallet is already connected (that account wins).
 */
export function useRheaMcaAccount(enabled = true): string | null {
  const { block } = useMultichainPortfolio({ enabled });
  if (!enabled) return null;
  const rhea = block?.sections.find((section) => section.key === "rhea");
  if (!rhea || rhea.status !== "ok") return null;
  return rhea.mca?.trim() || null;
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

/* ── GET /outcomes (§018/US5 — realized-outcomes ledger) ───────────────────── */

/** The realized-outcomes ledger view + fetch state. `null` when offline. A confirmed-but-empty
 * ledger (`loaded && view.rows.length === 0`) — whether because nothing has been withdrawn or the
 * history doesn't reconcile — is distinct from still-loading/failed, so the page can show an honest
 * empty/pending state rather than a fabricated number. Re-exports the pure {@link OutcomesView}. */
export type { OutcomesView } from "@/lib/agent/outcomesView";

export interface OutcomesState {
  view: OutcomesView;
  isLoading: boolean;
  isError: boolean;
  loaded: boolean;
  refetch: () => void;
}

export function useOutcomes(): OutcomesState | null {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "outcomes", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => client!.request<OutcomesResponseDto>("/outcomes", { signal }),
  });
  if (!online) return null;
  const d = query.data;
  return {
    view: toOutcomesView(d),
    isLoading: query.isLoading,
    isError: query.isError,
    loaded: query.isSuccess && d !== undefined,
    refetch: () => void query.refetch(),
  };
}

/* ── GET /outcomes/{recId} (§020/US5 — one recommendation's outcome detail) ─── */

/** The per-recommendation view + row are pure; re-exported so the /outcomes page consumes one type. */
export type {
  RecommendationOutcomeView,
  RecommendationOutcomeDetailView,
  OutcomeKind,
  OutcomeLabel,
} from "@/lib/agent/outcomesView";

/** One acted-on recommendation's live outcome detail + fetch state. `null` when offline or no recId. */
export interface OutcomeDetailState {
  view: RecommendationOutcomeDetailView | null;
  isLoading: boolean;
  isError: boolean;
  /** The agent error code when the fetch failed (e.g. `DATA_STALE` while syncing, `NOT_FOUND`). */
  errorCode?: string;
}

/**
 * The full outcome detail for one acted-on recommendation (`GET /outcomes/{recId}`) — its stored
 * rationale + proposed action, and its LIVE realized/unrealized PnL and realized APY. Advisory read
 * (no key, no fund move — never on the exit path, N2): a degraded chain read surfaces as an honest
 * `DATA_STALE` code the caller can explain, never a fabricated figure. `null` when offline or no
 * `recId` is requested (so the caller can lazily fetch only the expanded row).
 */
export function useOutcomeDetail(recId: string | null): OutcomeDetailState | null {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "outcome-detail", recId, identity?.account, identity?.chainId],
    enabled: online && !!recId,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) =>
      client!.request<RecommendationOutcomeDetailDto>(`/outcomes/${encodeURIComponent(recId!)}`, {
        signal,
      }),
  });
  if (!online || !recId) return null;
  const err = query.error;
  return {
    view: toOutcomeDetailView(query.data),
    isLoading: query.isLoading,
    isError: query.isError,
    errorCode: err instanceof AgentApiError ? err.code : undefined,
  };
}

/* ── GET /notifications + POST /notifications/read (§3.11 — real in-app feed) ── */

/** The real notifications feed view + fetch state. `null` when offline. Re-exports {@link NotificationsView}. */
export type { NotificationView, NotificationsView } from "@/lib/agent/notificationsView";

export interface NotificationsState {
  view: NotificationsView;
  isLoading: boolean;
  isError: boolean;
  loaded: boolean;
  refetch: () => void;
}

/**
 * The user's real in-app notifications (§3.11) — derived server-side from indexed on-chain activity,
 * never a mock. `null` when offline (the bell shows no count, honestly). The category preferences are
 * applied by the caller (the on-device `NotifKey` toggles), so the badge + drawer match the settings.
 */
export function useNotifications(): NotificationsState | null {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "notifications", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => client!.request<NotificationsResponseDto>("/notifications", { signal }),
  });
  if (!online) return null;
  const d = query.data;
  return {
    // Relative-time labels need the current wall clock; this display-only impurity is intentional.
    // eslint-disable-next-line react-hooks/purity
    view: toNotificationsView(d, Date.now()),
    isLoading: query.isLoading,
    isError: query.isError,
    loaded: query.isSuccess && d !== undefined,
    refetch: () => void query.refetch(),
  };
}

/**
 * Advance the read cursor (mark the currently-shown feed read) — called when the bell drawer or the
 * /notifications page opens. Best-effort: it invalidates the feed so the unread badge clears, and
 * NEVER throws (an advisory write; a failure just leaves the badge). No-op when offline.
 */
export function useMarkNotificationsRead(): () => void {
  const { client, online } = useAgentClient();
  const queryClient = useQueryClient();
  return useCallback(() => {
    if (!online || !client) return;
    void client
      .request("/notifications/read", { method: "POST", body: {} })
      .then(() => queryClient.invalidateQueries({ queryKey: ["agent", "notifications"] }))
      .catch(() => {
        /* advisory: the badge just won't clear this time (N2) */
      });
  }, [client, online, queryClient]);
}

/* ── GET /recommendations (§3.4) ───────────────────────────────────────────── */

// `RecommendationDto`, `RecView`, `RecCitation`, and the pure `toRecView` mapper live in
// `recView.ts` (dependency-free, unit-tested). Re-exported below so existing imports hold.
export type { RecView, RecCitation } from "@/lib/agent/recView";

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
export function useRecommendationsView(): RecView[] | null {
  const { client, online, identity } = useAgentClient();
  // 030 — the card's fit line is derived from the user's SAVED plan, not asserted. Before this
  // it was a hardcoded string, so a growth mandate was told "Fits your plan: lower risk".
  const mandate = useMandate();
  // 061 A9 — WITHOUT A MANDATE THE AGENT CORRECTLY ANSWERS 404 ("prompt onboarding"). The
  // strategies screen asked anyway on every visit, so beta's network console filled with 404s
  // and the page fell back to mock cards. Ask only when there is a plan to rank against; a
  // missing plan is the honest empty state, not a request that cannot succeed.
  const mandateReady = mandate.status === "ready";
  const query = useQuery({
    queryKey: ["agent", "recommendations", identity?.account, identity?.chainId],
    enabled: online && mandateReady,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return await client!.request<RecommendationsResponse>("/recommendations?limit=5", { signal });
      } catch (e) {
        // Belt-and-braces: a race between the mandate read and this request can still surface a
        // 404. Treat it as "nothing ranked yet" (an empty state), never as a broken live surface.
        if (e instanceof AgentApiError && (e.httpStatus === 404 || e.code === "NOT_FOUND")) {
          return { recommendations: [] };
        }
        throw e;
      }
    },
  });

  if (!online) return null;
  if (mandate.status === "empty") return [];
  const recs = query.data?.recommendations;
  if (!Array.isArray(recs)) return null;

  const mandateTier = mandate.status === "ready" ? mandate.mandate.tier : undefined;
  return recs.map((r, i) => toRecView(r, i, mandateTier));
}

/**
 * 061 A9 — whether the Strategies destination has anything to show.
 *
 * Hiding a nav entry is only safe when the answer is KNOWN (N2: never bury a reachable page).
 * So this hides only on a positive empty result — a plan that ranks zero strategies. Offline,
 * loading, or an errored mandate/recommendation read all keep the entry visible; the page itself
 * explains the state. The ⌘K palette still lists it either way.
 */
export function useStrategiesVisible(): boolean {
  const { online, identity } = useAgentClient();
  const mandate = useMandate();
  const queryClient = useQueryClient();
  if (mandate.status === "empty") return false;
  if (!online || mandate.status !== "ready") return true;
  // READ THE CACHE, NEVER FETCH. This runs in the nav on every app page, and `/recommendations`
  // is a metered LLM call — asking it globally would burn a recommendation quota to decide whether
  // to draw a tab. The Strategies page populates this same query key when it loads; until then the
  // answer is "unknown", and unknown keeps the entry visible (N2).
  const cached = queryClient.getQueryData<RecommendationsResponse>([
    "agent",
    "recommendations",
    identity?.account,
    identity?.chainId,
  ]);
  return strategiesNavVisible({
    mandateStatus: mandate.status,
    recommendations: cached?.recommendations ?? null,
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
  /** 030 — all optional; omitted means the user never stated it (never zero). */
  riskTier?: number;
  exposureLimitUsdc?: string;
  exposureLimitPctBps?: number;
  goalTargetUsdc?: string;
  goalTargetDate?: string;
  allowedProtocols?: string[];
  contribution?: { amountUsdc: string; cadence: string };
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
   * Persist a confirmed mandate via `POST /mandate` (FR-002). Resolves a TYPED
   * {@link MandateSaveOutcome} — a server rejection (with its §1.6 code + message) is
   * distinguishable from a transport failure, so the caller can say what actually went
   * wrong. The mandate is advisory config — it never authorizes funds.
   */
  confirmMandate: (mandate: MandateDraft) => Promise<MandateSaveOutcome>;
}

export function useOnboarding(): OnboardingDriver {
  const { client, online } = useAgentClient();
  const queryClient = useQueryClient();

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
          if (typeof res.value !== "string") continue; // 059 text-delta — not a block
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
    async (mandate: MandateDraft): Promise<MandateSaveOutcome> => {
      if (!client) return { ok: false, failure: { kind: "offline" } };
      try {
        const res = await client.request<{ mandate?: unknown }>("/mandate", {
          method: "POST",
          body: { mandate },
          // §1.3 requires a UUID — the middleware 400s anything else BEFORE the route runs, which
          // is what a `mandate-<wallet>-v<version>` key hit on every single save (025).
          //
          // FRESH PER ATTEMPT, deliberately. Since 023 the agent's idempotency cache is DURABLE
          // (Postgres, migration 0027) and scoped `(account, chain_id, method, path, key)`. The
          // draft hardcodes `version: 1`, so a key that is stable per user+version would make the
          // first successful 201 replay forever — every later edit answering 201 with the ORIGINAL
          // mandate and silently persisting nothing. A per-attempt key still de-dupes the only
          // replay that can actually happen here (a double-click / retry re-sending the same
          // request object is a different submission, and saving the same plan twice is a no-op
          // against a versioned store).
          idempotencyKey: crypto.randomUUID(),
        });
        // Instant reflect: the settings tab / chat rail / portfolio drift read `useMandate`
        // (["agent","mandate"]); invalidate so a freshly-saved plan shows without a remount.
        void queryClient.invalidateQueries({ queryKey: ["agent", "mandate"] });
        // `client.request` throws on a non-2xx, so reaching here means the POST SUCCEEDED. Return
        // the echoed mandate when present, else the response object itself — a success whose body
        // omits `mandate` must NOT surface as a false "Try again" (US1 AC2).
        return { ok: true, mandate: res?.mandate ?? res ?? null };
      } catch (err) {
        // Do NOT swallow: the caller needs to tell a server rejection (a real code + message it can
        // quote) apart from a transport failure, or every failure reads as "check your connection".
        return { ok: false, failure: classifyMandateSaveError(err) };
      }
    },
    [client, queryClient],
  );

  return { online, runReview, confirmMandate };
}

/* ── 030 · editing ONE field of a saved plan ───────────────────────────────── */

/** The fields Settings can change individually. Everything else is carried over untouched. */
export interface MandatePatch {
  riskTier?: number;
  maxSlippageBps?: number;
  horizonMonths?: number;
  exposureLimitUsdc?: string | null;
  exposureLimitPctBps?: number | null;
  goalTargetUsdc?: string | null;
  goalTargetDate?: string | null;
  contribution?: { amountUsdc: string; cadence: string } | null;
}

/**
 * Change one thing about a saved plan.
 *
 * 030/FR-014 — Settings → Mandate was entirely read-only, and its "Edit" button re-ran the whole
 * conversational onboarding flow. Adjusting one slippage value meant re-answering the drawdown
 * question. For a plan the product wants people to MAINTAIN, that is the wrong friction.
 *
 * The agent stores mandates as an immutable version series, so an edit is a new confirmed version
 * built from the current one plus the change — not a partial write. That keeps the audit trail
 * intact and means nothing can be lost by editing one field.
 *
 * `null` explicitly CLEARS a field; `undefined` leaves it alone. The distinction matters because
 * absence means "never stated" and must be reachable again after a value has been set.
 */
export function useUpdateMandate(): {
  update: (patch: MandatePatch) => Promise<MandateSaveOutcome>;
  pending: boolean;
} {
  const { confirmMandate } = useOnboarding();
  const mandate = useMandate();
  const [pending, setPending] = useState(false);

  const update = useCallback(
    async (patch: MandatePatch): Promise<MandateSaveOutcome> => {
      if (mandate.status !== "ready") {
        return { ok: false, failure: { kind: "offline" } };
      }
      const m = mandate.mandate;
      const tier = patch.riskTier ?? m.tier;
      const pick = <T,>(next: T | null | undefined, current: T | undefined): T | undefined =>
        next === null ? undefined : (next ?? current);

      setPending(true);
      try {
        return await confirmMandate({
          goals: m.goals.length > 0 ? m.goals : [{ kind: "steady_yield", label: m.goal }],
          riskProfile: tier <= 2 ? "conservative" : tier <= 3 ? "moderate" : "growth",
          riskParams: {
            maxSlippageBps: patch.maxSlippageBps ?? m.maxSlippageBps ?? 50,
            drawdownTolerance: m.drawdownTolerance ?? (tier <= 2 ? "low" : tier <= 3 ? "medium" : "high"),
            horizonMonths: patch.horizonMonths ?? horizonMonthsOf(m) ?? 12,
          },
          // Derived, so an edit can never re-save the stale self-contradictory string.
          summaryText: mandateSummary(tier),
          riskTier: tier,
          exposureLimitUsdc: pick(patch.exposureLimitUsdc, m.exposureLimitUsdc),
          exposureLimitPctBps: pick(patch.exposureLimitPctBps, m.exposureLimitPctBps),
          goalTargetUsdc: pick(patch.goalTargetUsdc, m.goalTargetUsdc),
          goalTargetDate: pick(patch.goalTargetDate, m.goalTargetDate),
          allowedProtocols: m.allowedProtocols,
          contribution: pick(patch.contribution, m.contribution),
          version: 1,
        } as MandateDraft);
      } finally {
        setPending(false);
      }
    },
    [confirmMandate, mandate],
  );

  return { update, pending };
}

/** The horizon in months, recovered from the human timeline the view carries. */
function horizonMonthsOf(m: MandateView): number | undefined {
  const years = /([\d.]+) year/.exec(m.timeline);
  if (years) return Math.round(parseFloat(years[1]) * 12);
  const months = /(\d+) month/.exec(m.timeline);
  return months ? parseInt(months[1], 10) : undefined;
}

/* ── GET /mandate (§3.1) — the user's real persisted plan ───────────────────── */

interface MandateResponse {
  mandate?: MandateWire | null;
}

/**
 * The mandate surface state. Honest, non-collapsing states (mirrors the loaded/isLoading/
 * isError discipline of `usePositionTransactions`): `disconnected` (no wallet — the BFF is
 * session-gated), `loading`, `error`, `empty` (loaded, none persisted yet), and `ready`
 * with the mapped view. The three mandate renders (settings tab, chat rail, portfolio
 * drift) branch on `status` — no more hardcoded tier-1 mock.
 */
export type MandateState =
  | { status: "disconnected" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; mandate: MandateView };

/**
 * Read the user's active mandate via `GET /agent/mandate` (§3.1). Owner is derived
 * server-side from the verified SIWE session in the BFF — the browser never asserts it. A
 * GET carries no body, so the BFF's GET forward handles it. Advisory only (non-custody).
 */
export function useMandate(): MandateState {
  const { client, online, identity, loading } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "mandate", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => client!.request<MandateResponse>("/mandate", { signal }),
  });

  // Session still resolving with no wallet: no plan read is possible yet, but this is not the
  // honest "disconnected" state — show loading so the card never prompts to sign in mid-fetch.
  if (loading) return { status: "loading" };
  if (!online) return { status: "disconnected" };
  if (query.isLoading) return { status: "loading" };
  if (query.isError) return { status: "error" };
  const view = mandateView(query.data?.mandate);
  return view ? { status: "ready", mandate: view } : { status: "empty" };
}

/** Re-export the pure drift helper so screens import mandate wiring from one place. */
export { mandateDrift, driftLabel, mandateSummary, type DriftStatus, type MandateView };

/** Re-exported so the onboarding dock imports the save outcome + its copy from one place. */
export { mandateSaveHint } from "@/lib/agent/mandateSave";
export type { MandateSaveOutcome, MandateSaveFailure } from "@/lib/agent/mandateSave";


/* ── GET /memory/self + POST /memory/clear (feature 027) ───────────────────── */

export interface SparkyMemoryState {
  /** The remembered lines, newest first. Empty is a completely normal state. */
  view: MemoryView;
  isLoading: boolean;
  isError: boolean;
  loaded: boolean;
  refetch: () => void;
}

/**
 * What Sparky remembers about the connected wallet, across conversations (feature 027).
 *
 * Session-scoped server-side: the BFF derives the owner from the verified SIWE session, so this
 * can only ever return the caller's OWN memory — there is no id to pass and no way to ask for
 * someone else's. `null` when offline (no wallet), which the Settings card renders as its
 * disconnected state rather than as "you have no memory".
 *
 * ADVISORY ONLY: these lines are context for suggestions and answers. Nothing here authorizes
 * anything, and nothing on this path can move funds (N2) — the card says so in plain words.
 */
export function useSparkyMemory(): SparkyMemoryState | null {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "memory", identity?.account],
    enabled: online,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => client!.request<MemoryResponseDto>("/memory/self", { signal }),
  });
  if (!online) return null;
  return {
    view: toMemoryView(query.data),
    isLoading: query.isLoading,
    isError: query.isError,
    loaded: query.isSuccess && query.data !== undefined,
    refetch: () => void query.refetch(),
  };
}

/**
 * Erase everything Sparky remembers about the connected wallet.
 *
 * Unlike the advisory writes elsewhere in this module, this one REPORTS FAILURE: the user pressed
 * a button labelled "Clear memory", so resolving `false` when the server refused is the difference
 * between an honest UI and one that lies about having deleted something. On success the memory
 * query is invalidated so the list reflects reality immediately.
 */
export function useClearSparkyMemory(): () => Promise<boolean> {
  const { client, online } = useAgentClient();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (!online || !client) return false;
    try {
      await client.request("/memory/clear", { method: "POST", body: {} });
      await queryClient.invalidateQueries({ queryKey: ["agent", "memory"] });
      return true;
    } catch {
      return false;
    }
  }, [client, online, queryClient]);
}

export type { MemoryView, MemoryRow } from "@/lib/agent/memoryView";
