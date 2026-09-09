/**
 * Typed client for the Hermes agent service (T027).
 *
 * Mirrors the Frontend ↔ Orchestrator wire contract in
 * `specs/001-sparkpoint-pivot-mvp/contracts/agent-service-api.md`:
 *   - §1.1  base path `/api/v1` (versioned)
 *   - §1.2  auth/session headers (Authorization bearer + X-Account / X-Owner /
 *           X-Chain-Id); identity = smart-account address + owner EOA
 *   - §1.3  Idempotency-Key on build/mutating POSTs (caller-owned)
 *   - §1.5  the canonical error envelope → parsed into a typed `AgentApiError`
 *   - §1.6  canonical error codes
 *   - §2.7  ChatBlock SSE envelope (framing in §3.2)
 *   - §3    endpoints (/chat SSE, /build-tx, /portfolio, /vault/quote/*, …)
 *
 * NON-CUSTODY (§0, N1/N3): this client is advisory. It only PROPOSES — it never
 * generates, sends, or accepts a signature or a signed payload. Signing happens
 * later in the wallet via the ExecutionDrawer, and `/submit-signed-tx` is
 * deliberately NOT surfaced here. `assertNoSignature` fail-closes any outgoing
 * body that carries a non-null signature/signed/rawTx field.
 */

/* ── identity & config (§1.2) ──────────────────────────────────────────────── */

/**
 * The per-user identity asserted to the agent service (§1.2). The smart-account
 * address is the identity anchor; the owner EOA is the sole admin signer. The
 * service NEVER treats these headers as authority to move funds — they only
 * scope reads/derivations and bind proposals to a user.
 */
export interface AgentIdentity {
  /** `X-Account` — the user's SparkPointAccount (may be counterfactual/undeployed). */
  account: `0x${string}`;
  /** `X-Owner` — the sole admin signer (owner EOA). */
  owner: `0x${string}`;
  /** `X-Chain-Id` — 8453 (Base) | 84532 (Base Sepolia). */
  chainId: number;
}

/** A lazily-resolved identity so call sites can bind to wallet/session state. */
export type AgentIdentityInput =
  | AgentIdentity
  | (() => AgentIdentity | Promise<AgentIdentity>);

export interface AgentClientConfig {
  /**
   * Overrides the default same-origin BFF base (`/api/agent`). Resolved lazily,
   * per request. Normally omitted: the browser hits the web app's own origin and
   * the server-side BFF injects the bearer + forwards to the agent.
   */
  baseUrl?: string;
  /** Default identity; may be overridden per call. */
  identity?: AgentIdentityInput;
}

export interface AgentRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON-serialized as the request body (any non-`undefined` value ⇒ a body). */
  body?: unknown;
  /**
   * `Idempotency-Key` (§1.3). CALLER-OWNED and stable across retries of the same
   * logical build/mutating op — never auto-generated here (a fresh key per retry
   * would defeat replay de-duplication).
   */
  idempotencyKey?: string;
  /** Overrides the client-level identity for this call. */
  identity?: AgentIdentity;
  signal?: AbortSignal;
}

export interface AgentStreamOptions {
  idempotencyKey?: string;
  identity?: AgentIdentity;
  signal?: AbortSignal;
}

/* ── /chat request + terminal summary (§3.2) ───────────────────────────────── */

/** `POST /chat` request body (§3.2). */
export interface ChatTurnRequest {
  /** Omit to start a conversation; echoed back on the `done` event. */
  conversationId?: string;
  message: string;
  /** `surface` hints UI intent (chat | strategy | vault | portfolio). */
  context?: { surface?: "chat" | "strategy" | "vault" | "portfolio" };
  /** ISO-8601 client clock. */
  clientTime?: string;
}

/** The `event: done` terminal frame payload of a `/chat` stream (§3.2). */
export interface ChatStreamDone {
  conversationId?: string;
  blockCount?: number;
}

/* ── typed errors (§1.5 / §1.6) ────────────────────────────────────────────── */

/** Canonical error codes (§1.6). Kept open (`string`) for forward-compat. */
export const AGENT_ERROR_CODES = [
  "UNAUTHENTICATED",
  "ACCOUNT_HEADERS_INVALID",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "BETA_NOT_ENABLED",
  "GEO_BLOCKED",
  "POLICY_REJECTED",
  "CAP_EXCEEDED",
  "SLIPPAGE_EXCEEDED",
  "SIMULATION_REVERT",
  "SIMULATION_UNAVAILABLE",
  "DATA_STALE",
  "KILL_SWITCH_PAUSED",
  "UPSTREAM_UNAVAILABLE",
  "REFUSAL",
  "RATE_LIMITED",
  "INTERNAL",
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

/** One structured reason inside the error envelope (§1.5). */
export interface AgentErrorReason {
  code: string;
  message: string;
}

/**
 * The typed form of the §1.5 error envelope. Every non-2xx REST response and
 * pre-stream `/chat` failure is thrown as this. Callers surface `.message` +
 * `.reasons` in chat/UI and branch on `.code` / `.retryable`.
 */
export class AgentApiError extends Error {
  /** `AgentErrorCode` when recognized; a raw string otherwise. */
  readonly code: AgentErrorCode | (string & {});
  readonly httpStatus: number;
  readonly reasons: readonly AgentErrorReason[];
  readonly retryable: boolean;
  readonly policyVersion?: string;
  readonly requestId?: string;
  /** `Retry-After` seconds for `RATE_LIMITED` (§1.6), when the header is set. */
  readonly retryAfterSeconds?: number;
  /** Mirrored `SimulationResult` for simulation-class errors, else `null`. */
  readonly simulation: unknown;

  constructor(init: {
    code: string;
    httpStatus: number;
    message: string;
    reasons?: readonly AgentErrorReason[];
    retryable?: boolean;
    policyVersion?: string;
    requestId?: string;
    retryAfterSeconds?: number;
    simulation?: unknown;
  }) {
    super(init.message);
    this.name = "AgentApiError";
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.reasons = init.reasons ?? [];
    this.retryable = init.retryable ?? false;
    this.policyVersion = init.policyVersion;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.simulation = init.simulation ?? null;
  }
}

/* ── URL + header + non-custody helpers ────────────────────────────────────── */

/** The same-origin BFF mount. A relative base ⇒ the browser hits its own origin. */
const DEFAULT_BASE_URL = "/api/agent";

function resolveBaseUrl(configBase?: string): string {
  // The browser ALWAYS calls the same-origin BFF (`/api/agent`): the server-side route
  // handler adds the bearer + forwards to the agent, so NO agent URL or token ever reaches
  // the client bundle. There is deliberately NO `NEXT_PUBLIC_AGENT_BASE_URL` override — it
  // would let a deploy redirect user-scoped calls (with wallet-address headers) straight at
  // the agent, bypassing the BFF. `configBase` remains only as an explicit programmatic
  // override for tests; production never sets it.
  const raw = configBase ?? DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function joinPath(base: string, path: string): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Build the §1.2 request headers. NO `Authorization` is set here: the browser
 * holds no service bearer — the same-origin BFF injects it server-side. Only the
 * identity/idempotency headers cross the wire; `Content-Type` only when there is a
 * body. (For an optional direct-to-agent override the BFF is bypassed, and the
 * agent is keyless/advisory, so the absent bearer stays non-custodial regardless.)
 */
function buildHeaders(
  identity: AgentIdentity,
  opts: { accept: "json" | "sse"; hasBody: boolean; idempotencyKey?: string },
): Headers {
  const headers = new Headers();
  headers.set("X-Account", identity.account);
  headers.set("X-Owner", identity.owner);
  // 029, belt-and-braces (kept dependency-free — this module deliberately imports nothing):
  // the identity builder already guards this, but a future identity source must not be able to
  // put a non-finite value on the wire again. `String(NaN)` === "NaN", which the agent refuses
  // and which the user saw rendered as an assistant message on 7/7 requests.
  //
  // A malformed value is DROPPED rather than replaced with a guessed chain. Guessing here is what
  // turned the NaN bug into a wave of 503s: this module cannot know which chain the deployment
  // operates on, and asserting the wrong one produces reads against a chain with no deployment.
  // Omitting the header lets the agent answer with its own §1.6 error, which the chat now renders
  // as an honest, retryable failure — a truthful "we don't know" beats a confident wrong answer.
  const chainId = Number(identity.chainId);
  if (Number.isFinite(chainId) && Number.isInteger(chainId) && chainId > 0) {
    headers.set("X-Chain-Id", String(chainId));
  }
  headers.set("Accept", opts.accept === "sse" ? "text/event-stream" : "application/json");
  if (opts.hasBody) headers.set("Content-Type", "application/json");
  if (opts.idempotencyKey) headers.set("Idempotency-Key", opts.idempotencyKey);
  return headers;
}

/**
 * Fail-closed non-custody guard (N1/N3): refuse to transmit any body that
 * carries a non-null `signature` / `signed` / `rawTx` field. This client only
 * proposes — a signature belongs to the wallet's `/submit-signed-tx` path, which
 * this client does not implement.
 */
function assertNoSignature(value: unknown, seen: Set<object> = new Set()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoSignature(item, seen);
    return;
  }
  for (const [key, val] of Object.entries(value)) {
    const k = key.toLowerCase();
    if ((k === "signature" || k === "signed" || k === "rawtx") && val !== null && val !== undefined) {
      throw new Error(
        `AgentClient refuses to send a request carrying a non-null "${key}" field — ` +
          "this client only proposes; signing happens in the wallet/ExecutionDrawer (N1/N3).",
      );
    }
    assertNoSignature(val, seen);
  }
}

/** Parse a non-2xx response into a typed `AgentApiError` (§1.5), fail-closed. */
async function parseErrorEnvelope(res: Response): Promise<AgentApiError> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }

  const retryAfterHeader = res.headers.get("Retry-After");
  const retryAfterSeconds =
    retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;

  const env =
    parsed && typeof parsed === "object" && "error" in parsed
      ? (parsed as { error?: Record<string, unknown> }).error
      : undefined;

  if (env && typeof env === "object") {
    const rawReasons = Array.isArray(env.reasons) ? env.reasons : [];
    const reasons: AgentErrorReason[] = rawReasons
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({
        code: typeof r.code === "string" ? r.code : "INTERNAL",
        message: typeof r.message === "string" ? r.message : "",
      }));
    return new AgentApiError({
      code: typeof env.code === "string" ? env.code : "INTERNAL",
      httpStatus: typeof env.httpStatus === "number" ? env.httpStatus : res.status,
      message:
        typeof env.message === "string" && env.message
          ? env.message
          : res.statusText || `Agent request failed (${res.status})`,
      reasons,
      retryable: env.retryable === true,
      policyVersion: typeof env.policyVersion === "string" ? env.policyVersion : undefined,
      requestId: typeof env.requestId === "string" ? env.requestId : undefined,
      retryAfterSeconds,
      simulation: "simulation" in env ? env.simulation : null,
    });
  }

  // Envelope missing/malformed → fail-closed generic error (never a signable path).
  return new AgentApiError({
    code: "INTERNAL",
    httpStatus: res.status,
    message: res.statusText || `Agent request failed (${res.status})`,
    retryable: res.status >= 500,
    retryAfterSeconds,
  });
}

/* ── SSE reader (fetch + ReadableStream, no new deps) ──────────────────────── */

interface SseFrame {
  event: string;
  data: string;
}

/** Locate the first blank-line frame separator, tolerating `\n`, `\r\n`, `\r`. */
function splitFrame(buffer: string): { frame: string; rest: string } | null {
  let boundary = -1;
  let sepLen = 0;
  for (const sep of ["\r\n\r\n", "\n\n", "\r\r"]) {
    const idx = buffer.indexOf(sep);
    if (idx !== -1 && (boundary === -1 || idx < boundary)) {
      boundary = idx;
      sepLen = sep.length;
    }
  }
  if (boundary === -1) return null;
  return { frame: buffer.slice(0, boundary), rest: buffer.slice(boundary + sepLen) };
}

/** Parse one SSE frame into `{ event, data }`; `null` when it carries no data. */
function parseFrame(frame: string): SseFrame | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split(/\r\n|\r|\n/)) {
    if (line === "" || line.startsWith(":")) continue; // blank / comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
    // `id` / `retry` are not used by this contract.
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

async function* readSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame, void, void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = splitFrame(buffer);
      while (split) {
        buffer = split.rest;
        const parsed = parseFrame(split.frame);
        if (parsed) yield parsed;
        split = splitFrame(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const parsed = parseFrame(buffer);
      if (parsed) yield parsed;
    }
  } finally {
    reader.releaseLock();
  }
}

/* ── the client ────────────────────────────────────────────────────────────── */

export interface AgentClient {
  /**
   * REST helper (§1.2/§1.5). Sets the auth/session headers, JSON-encodes the
   * body (fail-closed on any signature field), and throws `AgentApiError` on any
   * non-2xx. Returns the parsed JSON body (`undefined` for 204/empty).
   */
  request<T = unknown>(path: string, options?: AgentRequestOptions): Promise<T>;
  /**
   * Generic SSE helper for any streamed ChatBlock endpoint (e.g. `/chat`,
   * `/onboarding/turn` — §3.1/§3.2). Yields the raw `data` string of each block
   * frame (validate fail-closed via `cards.ts`); the generator's RETURN value is
   * the terminal `done` summary. Throws `AgentApiError` on a pre-stream non-2xx.
   * Like `streamChat`, it only PROPOSES — `assertNoSignature` fail-closes the body.
   */
  stream(
    path: string,
    body: unknown,
    options?: AgentStreamOptions,
  ): AsyncGenerator<string, ChatStreamDone | undefined, void>;
  /**
   * SSE helper for `POST /chat` (§3.2). Yields the raw `data` string of each
   * ChatBlock frame (for `cards.ts` to validate fail-closed); the generator's
   * RETURN value is the terminal `done` summary. Throws `AgentApiError` on a
   * pre-stream non-2xx. Thin wrapper over `stream("/chat", …)`.
   */
  streamChat(
    request: ChatTurnRequest,
    options?: AgentStreamOptions,
  ): AsyncGenerator<string, ChatStreamDone | undefined, void>;
}

export function createAgentClient(config: AgentClientConfig = {}): AgentClient {
  async function resolveIdentity(override?: AgentIdentity): Promise<AgentIdentity> {
    if (override) return override;
    const source = config.identity;
    if (!source) {
      throw new Error(
        "AgentClient: no identity provided — pass `identity` on the client config or per call (X-Account / X-Owner / X-Chain-Id are required, §1.2).",
      );
    }
    return typeof source === "function" ? source() : source;
  }

  async function request<T = unknown>(
    path: string,
    options: AgentRequestOptions = {},
  ): Promise<T> {
    const identity = await resolveIdentity(options.identity);
    const hasBody = options.body !== undefined;
    if (hasBody) assertNoSignature(options.body);

    const res = await fetch(joinPath(resolveBaseUrl(config.baseUrl), path), {
      method: options.method ?? (hasBody ? "POST" : "GET"),
      headers: buildHeaders(identity, {
        accept: "json",
        hasBody,
        idempotencyKey: options.idempotencyKey,
      }),
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });

    if (!res.ok) throw await parseErrorEnvelope(res);
    if (res.status === 204 || res.status === 205) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async function* stream(
    path: string,
    body: unknown,
    options: AgentStreamOptions = {},
  ): AsyncGenerator<string, ChatStreamDone | undefined, void> {
    const identity = await resolveIdentity(options.identity);
    assertNoSignature(body);

    const res = await fetch(joinPath(resolveBaseUrl(config.baseUrl), path), {
      method: "POST",
      headers: buildHeaders(identity, {
        accept: "sse",
        hasBody: true,
        idempotencyKey: options.idempotencyKey,
      }),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) throw await parseErrorEnvelope(res);
    if (!res.body) {
      throw new AgentApiError({
        code: "INTERNAL",
        httpStatus: res.status,
        message: `Agent ${path} stream returned no body.`,
        retryable: true,
      });
    }

    for await (const frame of readSse(res.body)) {
      if (frame.event === "done") {
        // Terminal summary (§3.2). Parsed leniently; never a ChatBlock.
        try {
          const summary = JSON.parse(frame.data) as ChatStreamDone;
          return {
            conversationId:
              typeof summary.conversationId === "string" ? summary.conversationId : undefined,
            blockCount: typeof summary.blockCount === "number" ? summary.blockCount : undefined,
          };
        } catch {
          return undefined;
        }
      }
      // ChatBlock frames (§2.7): `event: block`, the SSE default `message`, or an
      // explicit `error` block. Anything else is ignored so no non-block payload
      // is ever fed to the renderer. `cards.ts` validates each string fail-closed.
      if (frame.event === "block" || frame.event === "message" || frame.event === "error") {
        yield frame.data;
      }
    }
    return undefined;
  }

  async function* streamChat(
    chatRequest: ChatTurnRequest,
    options: AgentStreamOptions = {},
  ): AsyncGenerator<string, ChatStreamDone | undefined, void> {
    return yield* stream("/chat", chatRequest, options);
  }

  return { request, stream, streamChat };
}
