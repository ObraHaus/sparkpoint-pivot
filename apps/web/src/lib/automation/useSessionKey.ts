"use client";

/**
 * useSessionKey (US6) — the live data source + tx drivers for scoped session-key automation.
 *
 * This is the seam that retires the `data.sessionKey` mock: it reads the user's REAL grants from the
 * deployed ERC-4337 stack (SparkPointAccount + SessionKeyValidator + PolicyModule on Base Sepolia)
 * through the same-origin agent BFF, and it builds/sends the grant + revoke transactions the USER
 * signs from their own wallet. SparkPoint holds no key and signs nothing (N1/N3): the grant is an
 * OWNER-signed tx to the smart account, and revoke is a sacred exit the user can always send.
 *
 *   - `useSessionKeys()`   — GET /session-keys, react-query (mirrors useOutcomes/useNotifications).
 *   - `useGrantBuilder()`  — POST /session-keys/grant/build → { ok, reasons, scopeEcho, tx }.
 *   - `useRevokeBuilder()` — POST /session-keys/revoke/build → { tx } (ALWAYS returns a tx).
 *   - `useSessionKeyTx()`  — sign a server-built { to, data, value, chainId } VERBATIM via the wallet
 *                            (wagmi) and confirm it on-chain (direct RPC), mirroring useExecutionSign.
 *
 * Honest undefined-guard: loading / no-wallet → `null`/`…`, NEVER a fabricated zero grant.
 */

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import type { Hex } from "viem";

import { AgentApiError } from "@/lib/agent/client";
import { useAgentClient } from "@/lib/agent/useAgent";
import { wagmiConfig } from "@/lib/wagmi";

type WagmiChainId = (typeof wagmiConfig)["chains"][number]["id"];

/* ── wire shapes (GET /session-keys) ───────────────────────────────────────── */

export type SessionKeyStatus = "active" | "expired" | "revoked" | "exhausted";

/** One `(target, selector)` allowlist entry — the exact pair the on-chain PolicyModule checks. */
export interface SessionKeyAllowlistEntry {
  target: string;
  selector: string;
}

/**
 * One registered session key as returned by `GET /session-keys`. USDC amounts are base-unit
 * (6dp) strings; `validUntil`/`validAfter` are unix seconds; the tx hashes are on-chain proofs.
 */
export interface SessionKeyGrant {
  sessionKey: string;
  status: SessionKeyStatus;
  allowlist: SessionKeyAllowlistEntry[];
  perTxCap: string;
  cumulativeCap: string;
  spent: string;
  maxSlippageBps: number;
  validUntil: number;
  validAfter: number;
  registeredTxHash?: string | null;
  revokedTxHash?: string | null;
}

interface SessionKeysResponse {
  account?: string;
  sessionKeys?: SessionKeyGrant[];
}

/* ── small defensive coercions (the wire is trusted-but-verified) ──────────── */

const KNOWN_STATUS: ReadonlySet<string> = new Set(["active", "expired", "revoked", "exhausted"]);

function toStr(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Coerce one raw wire row into a `SessionKeyGrant`, never throwing (fail-open read, N2-safe). */
function normalizeGrant(raw: unknown): SessionKeyGrant | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sessionKey = toStr(r.sessionKey);
  if (!sessionKey) return null;
  const status = KNOWN_STATUS.has(toStr(r.status)) ? (r.status as SessionKeyStatus) : "expired";
  const allowlist = Array.isArray(r.allowlist)
    ? r.allowlist
        .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : null))
        .filter((e): e is Record<string, unknown> => e !== null)
        .map((e) => ({ target: toStr(e.target), selector: toStr(e.selector) }))
    : [];
  return {
    sessionKey,
    status,
    allowlist,
    perTxCap: toStr(r.perTxCap),
    cumulativeCap: toStr(r.cumulativeCap),
    spent: toStr(r.spent),
    maxSlippageBps: toNum(r.maxSlippageBps),
    validUntil: toNum(r.validUntil),
    validAfter: toNum(r.validAfter),
    registeredTxHash: typeof r.registeredTxHash === "string" ? r.registeredTxHash : null,
    revokedTxHash: typeof r.revokedTxHash === "string" ? r.revokedTxHash : null,
  };
}

/* ── GET /session-keys ─────────────────────────────────────────────────────── */

export interface SessionKeysState {
  /** The user's smart-account address (from the server), when known. */
  account?: string;
  grants: SessionKeyGrant[];
  /** The single active grant (`status === "active"`), or `null`. Honest: loading/none → `null`. */
  active: SessionKeyGrant | null;
  /** A wallet is connected (the BFF is session-gated); `false` ⇒ we cannot read, so show nothing. */
  online: boolean;
  isLoading: boolean;
  isError: boolean;
  /** A response was received (so `grants.length === 0` means genuinely no grants). */
  loaded: boolean;
  refetch: () => void;
}

/**
 * Read the user's live session-key grants via `GET /session-keys` (advisory read, never on the exit
 * path — N2). Returns `online: false` (and no grants) until a wallet is connected. A confirmed-empty
 * result (`loaded && grants.length === 0`) is distinct from loading/failed, so the UI can show an
 * honest empty state rather than a fabricated grant.
 */
export function useSessionKeys(): SessionKeysState {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "session-keys", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => client!.request<SessionKeysResponse>("/session-keys", { signal }),
  });

  if (!online) {
    return { grants: [], active: null, online: false, isLoading: false, isError: false, loaded: false, refetch: () => {} };
  }
  const d = query.data;
  const grants = Array.isArray(d?.sessionKeys)
    ? d!.sessionKeys.map(normalizeGrant).filter((g): g is SessionKeyGrant => g !== null)
    : [];
  return {
    account: d?.account,
    grants,
    active: grants.find((g) => g.status === "active") ?? null,
    online: true,
    isLoading: query.isLoading,
    isError: query.isError,
    loaded: query.isSuccess && d !== undefined,
    refetch: () => void query.refetch(),
  };
}

/* ── the server-built, user-signed transaction (grant + revoke share this shape) ── */

/** A raw, UNSIGNED transaction the server materialized for the user to sign VERBATIM. */
export interface RawTx {
  to: `0x${string}`;
  data: `0x${string}`;
  /** Wei, base-10 string (usually "0"); optional. */
  value?: string;
  chainId: number;
}

/* ── POST /session-keys/grant/build ────────────────────────────────────────── */

/** The policy-echoed scope the server will register — presented VERBATIM for the user to review. */
export interface GrantScopeEcho {
  sessionKey: string;
  validAfter: number;
  validUntil: number;
  perTxCap: string;
  cumulativeCap: string;
  maxSlippageBps: number;
  allowlist: SessionKeyAllowlistEntry[];
  recipientPin?: string | null;
  revocable?: boolean;
  spent?: string;
}

/** `POST /session-keys/grant/build` request body. Only the session key's PUBLIC address crosses. */
export interface GrantBuildRequest {
  sessionPubkey: string;
  validUntil: number;
  validAfter: number;
  perTxCap: string;
  cumulativeCap: string;
  maxSlippageBps: number;
  allowlist: SessionKeyAllowlistEntry[];
}

/** The result of a grant build: either `ok` (with a scopeEcho + signable tx) or the policy reasons. */
export interface GrantBuildResult {
  ok: boolean;
  policyVersion?: string;
  reasons: string[];
  scopeEcho: GrantScopeEcho | null;
  tx: RawTx | null;
}

interface GrantBuilderState {
  building: boolean;
  result: GrantBuildResult | null;
  /** A transport/auth failure (e.g. offline, not in the alpha) — distinct from a policy `ok:false`. */
  error: AgentApiError | null;
  build: (req: GrantBuildRequest) => Promise<GrantBuildResult | null>;
  reset: () => void;
}

/**
 * Build a scoped grant via `POST /session-keys/grant/build`. On `ok:false` the server returns policy
 * reasons and NO tx (fail-closed) at HTTP 200 — surfaced honestly, distinct from a transport error.
 */
export function useGrantBuilder(): GrantBuilderState {
  const { client } = useAgentClient();
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<GrantBuildResult | null>(null);
  const [error, setError] = useState<AgentApiError | null>(null);

  const build = useCallback(
    async (req: GrantBuildRequest): Promise<GrantBuildResult | null> => {
      if (!client) return null;
      setBuilding(true);
      setError(null);
      setResult(null);
      try {
        const raw = await client.request<Record<string, unknown>>("/session-keys/grant/build", {
          method: "POST",
          body: req,
        });
        const reasons = Array.isArray(raw.reasons) ? raw.reasons.map((x) => toStr(x)).filter(Boolean) : [];
        const parsed: GrantBuildResult = {
          ok: raw.ok === true,
          policyVersion: typeof raw.policyVersion === "string" ? raw.policyVersion : undefined,
          reasons,
          scopeEcho: (raw.scopeEcho as GrantScopeEcho | null) ?? null,
          tx: (raw.tx as RawTx | null) ?? null,
        };
        setResult(parsed);
        return parsed;
      } catch (e) {
        setError(
          e instanceof AgentApiError
            ? e
            : new AgentApiError({ code: "INTERNAL", httpStatus: 0, message: "Couldn't build the grant." }),
        );
        return null;
      } finally {
        setBuilding(false);
      }
    },
    [client],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setBuilding(false);
  }, []);

  return { building, result, error, build, reset };
}

/* ── POST /session-keys/revoke/build (sacred exit — ALWAYS returns a tx) ─────── */

interface RevokeBuilderState {
  building: boolean;
  error: AgentApiError | null;
  /** Build the revoke tx for `sessionPubkey`. Resolves the raw tx, or `null` on a transport failure. */
  build: (sessionPubkey: string) => Promise<RawTx | null>;
}

/**
 * Build the revoke tx via `POST /session-keys/revoke/build`. Revoke is never gated — the endpoint
 * always returns a tx — and the user signs it from their own wallet (SparkPoint cannot block an exit).
 */
export function useRevokeBuilder(): RevokeBuilderState {
  const { client } = useAgentClient();
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<AgentApiError | null>(null);

  const build = useCallback(
    async (sessionPubkey: string): Promise<RawTx | null> => {
      if (!client) return null;
      setBuilding(true);
      setError(null);
      try {
        const raw = await client.request<{ tx?: RawTx }>("/session-keys/revoke/build", {
          method: "POST",
          body: { sessionPubkey },
        });
        return raw?.tx ?? null;
      } catch (e) {
        setError(
          e instanceof AgentApiError
            ? e
            : new AgentApiError({ code: "INTERNAL", httpStatus: 0, message: "Couldn't build the revoke transaction." }),
        );
        return null;
      } finally {
        setBuilding(false);
      }
    },
    [client],
  );

  return { building, error, build };
}

/* ── sign a server-built tx VERBATIM (wallet) + confirm on-chain (direct RPC) ── */

export type TxStage = "idle" | "signing" | "confirming" | "done" | "error";

export interface SessionKeyTxController {
  stage: TxStage;
  txHash: Hex | undefined;
  chainId: number | undefined;
  error: string | undefined;
  isBusy: boolean;
  isDone: boolean;
  /** Sign + submit the server tx VERBATIM (no re-encode, N1/N3), then confirm it directly on-chain. */
  send: (tx: RawTx) => void;
  reset: () => void;
}

function shortError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string } | null;
  const msg = e?.shortMessage ?? e?.message ?? "Transaction failed.";
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

/**
 * Sign a `{ to, data, value, chainId }` VERBATIM via wagmi `useSendTransaction` (the user is the sole
 * signer — SparkPoint holds no key, N1/N3) and confirm it on the connected transport's own client
 * (`useWaitForTransactionReceipt` — direct RPC, never the agent, N2 independence). Shared by the grant
 * flow and the revoke flow. A reverted tx surfaces honestly and is never treated as success.
 */
export function useSessionKeyTx(): SessionKeyTxController {
  const { sendTransactionAsync } = useSendTransaction();
  const [phase, setPhase] = useState<"idle" | "signing" | "submitted" | "error">("idle");
  const [txHash, setTxHash] = useState<Hex>();
  const [chainId, setChainId] = useState<WagmiChainId>();
  const [submitError, setSubmitError] = useState<string>();

  // Confirm on the connected transport's own client (direct RPC, never the agent — N2 independence).
  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId, query: { enabled: !!txHash } });
  const reverted = receipt.isSuccess && receipt.data?.status === "reverted";
  const confirmed = receipt.isSuccess && receipt.data?.status !== "reverted";

  // Stage is DERIVED in render from the submit phase + the receipt query (no setState-in-effect).
  let stage: TxStage = "idle";
  if (phase === "signing") stage = "signing";
  else if (phase === "error") stage = "error";
  else if (phase === "submitted") stage = confirmed ? "done" : reverted || receipt.isError ? "error" : "confirming";

  const error =
    phase === "error"
      ? submitError
      : phase === "submitted" && reverted
        ? "Transaction reverted on-chain — nothing changed."
        : phase === "submitted" && receipt.isError
          ? "Couldn’t confirm the transaction on-chain."
          : undefined;

  const send = useCallback(
    (tx: RawTx) => {
      setSubmitError(undefined);
      setTxHash(undefined);
      setChainId(tx.chainId as WagmiChainId);
      setPhase("signing");
      void (async () => {
        try {
          // Sign the SERVER tx VERBATIM (no re-encode). The user is the sole signer (N1/N3).
          const hash = await sendTransactionAsync({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : 0n,
            chainId: tx.chainId as WagmiChainId,
          });
          setTxHash(hash);
          setPhase("submitted");
        } catch (err) {
          setSubmitError(shortError(err));
          setPhase("error");
        }
      })();
    },
    [sendTransactionAsync],
  );

  const reset = useCallback(() => {
    setPhase("idle");
    setTxHash(undefined);
    setChainId(undefined);
    setSubmitError(undefined);
  }, []);

  return {
    stage,
    txHash,
    chainId,
    error,
    isBusy: stage === "signing" || stage === "confirming",
    isDone: stage === "done",
    send,
    reset,
  };
}

/* ── query invalidation helper (refresh the grant list after a grant/revoke confirms) ── */

/** Invalidate the `GET /session-keys` cache so the automation card reflects a fresh grant/revoke. */
export function useInvalidateSessionKeys(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["agent", "session-keys"] });
  }, [queryClient]);
}
