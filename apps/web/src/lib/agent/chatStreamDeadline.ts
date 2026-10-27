/**
 * Idle/stall deadline for the BFF chat SSE passthrough (061 A9, OH Defender follow-up).
 *
 * The first version armed ONE timer at stream construction, so it capped the TOTAL time a turn
 * could stream (60s) rather than how long it could go SILENT. A legitimate slow answer was cut
 * off at 60s even while tokens kept arriving. This helper measures STALL time instead:
 *
 *   - the timer is re-armed on every upstream chunk, so a keepalive/comment frame (which arrives as
 *     a normal chunk) also counts as liveness;
 *   - the first chunk must still arrive within the same bound, which keeps the time-to-first-byte
 *     promise the UI already makes;
 *   - a separate absolute ceiling is the hard backstop for a stream that never ends but never goes
 *     quiet either (e.g. a keepalive every 20s forever).
 *
 * SCOPING (OH Defender MEDIUM): this whole machinery exists for the assistant's chat stream only.
 * The proxy used to arm the response-headers/connect deadline for EVERY agent request, so an
 * unrelated slow endpoint (portfolio, admin, …) was cut at 60s even though origin/main had no such
 * bound. Everything here is gated on {@link isChatStreamPath}, which matches the exact path the web
 * client streams (`/chat`) — never a substring/prefix (so `/chat/feedback`, `/admin/chat`, … are
 * untouched).
 *
 * BACKPRESSURE: relays are pull-based (`highWaterMark: 0`). The idle timer is armed only while a
 * `pull()` is actually waiting on the upstream for a chunk the downstream consumer asked for. When
 * the consumer stops reading, no `pull()` is in flight, the timer is cleared, and the stall clock
 * does not run — so a slow browser/backpressure can never manufacture a false timeout.
 *
 * On either deadline it emits the same honest `UPSTREAM_UNAVAILABLE` block the renderer already
 * understands. It deliberately does NOT cancel the agent's turn on the user's behalf: the quota is
 * charged at admission, and a BFF cancel looks like a client disconnect, which the agent does not
 * refund — so Retry would double-charge. The stream is drained for a bounded grace window instead,
 * and only released after that window expires.
 */

/** How long the upstream may go without a chunk (includes time to first byte). */
export const CHAT_STALL_TIMEOUT_MS = Number(process.env.AGENT_CHAT_TIMEOUT_MS ?? 60_000);

/** Absolute backstop for a stream that stays chatty but never finishes (e.g. endless keepalives). */
export const CHAT_STREAM_CEILING_MS = Number(
  process.env.AGENT_CHAT_STREAM_CEILING_MS ?? 5 * 60_000,
);

/**
 * The exact agent paths whose SSE body the web client consumes as the chat stream.
 *
 * `/chat` is `AgentClient.streamChat` (the only chat SSE route). Deliberately NOT matched by
 * prefix: `/chat/feedback` is JSON, `/onboarding/turn` is a different (origin/main-unchanged)
 * stream, and `admin/chat` is not a browser chat stream. Keep this list exact and empty of
 * lookalikes.
 */
const CHAT_STREAM_PATHS: ReadonlyArray<ReadonlyArray<string>> = [["chat"]];

/** True iff `path` is exactly one of the chat SSE routes above. */
export function isChatStreamPath(path: ReadonlyArray<string>): boolean {
  return CHAT_STREAM_PATHS.some(
    (candidate) =>
      candidate.length === path.length && candidate.every((segment, i) => segment === path[i]),
  );
}

/** A clean §2.7 error block as an already-framed SSE event. */
export function chatTimeoutEvent(): Uint8Array {
  const block = JSON.stringify({
    type: "error",
    code: "UPSTREAM_UNAVAILABLE",
    message: "Sparky took too long to answer. Nothing was signed or changed — you can try again.",
  });
  return new TextEncoder().encode(`event: block\ndata: ${block}\n\n`);
}

/** A connect deadline plus the cleanup that disarms it. */
export interface ConnectDeadline {
  readonly signal: AbortSignal;
  clear(): void;
}

/**
 * Add the chat response-headers deadline ONLY to a chat stream request.
 *
 * Non-chat paths get the caller's signal verbatim (no timer at all), so they behave exactly as
 * origin/main: a slow-but-healthy endpoint is not cut off. The caller must invoke {@link
 * ConnectDeadline.clear} once the fetch settles.
 */
export function withChatConnectDeadline(
  path: ReadonlyArray<string>,
  requestSignal: AbortSignal,
  idleMs: number = CHAT_STALL_TIMEOUT_MS,
): ConnectDeadline {
  if (!isChatStreamPath(path)) {
    return { signal: requestSignal, clear: () => {} };
  }
  const timerController = new AbortController();
  const timer = setTimeout(() => timerController.abort(), idleMs);
  return {
    signal: AbortSignal.any([requestSignal, timerController.signal]),
    clear: () => clearTimeout(timer),
  };
}

/**
 * Wrap the SSE body with the chat deadline, but ONLY for a chat stream path.
 *
 * Non-chat paths return the upstream body untouched — the identical stream object — so there is no
 * timer, no wrapper and no observable difference from origin/main.
 */
export function applyChatStreamDeadline(
  path: ReadonlyArray<string>,
  body: ReadableStream<Uint8Array>,
  idleMs: number = CHAT_STALL_TIMEOUT_MS,
  ceilingMs: number = CHAT_STREAM_CEILING_MS,
): ReadableStream<Uint8Array> {
  return isChatStreamPath(path) ? withChatDeadline(body, idleMs, ceilingMs) : body;
}

type ReadResult = ReadableStreamReadResult<Uint8Array>;
type Deadline = "timeout";
type DrainCap = "drain-cap";

/**
 * Drain the upstream after we stopped relaying it, so the agent can finish (and refund) its turn.
 * The drain is itself bounded by the same absolute ceiling; if the agent outlives that too, we
 * cancel and release the reader rather than holding the socket open for the life of the process.
 */
async function drainBounded(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pending: Promise<ReadResult>,
  capMs: number,
): Promise<void> {
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  let capped = false;
  const cap = new Promise<DrainCap>((resolve) => {
    capTimer = setTimeout(() => {
      capped = true;
      resolve("drain-cap");
    }, capMs);
  });
  try {
    let next: ReadResult | DrainCap = await Promise.race([pending, cap]);
    while (!capped && next !== "drain-cap" && !next.done) {
      next = await Promise.race([reader.read(), cap]);
    }
    if (capped || next === "drain-cap") {
      // The turn outlived the grace window: stop holding the upstream socket.
      await reader.cancel("chat drain ceiling reached").catch(() => {});
    }
  } catch {
    // The agent went away; there is nothing left to drain.
  } finally {
    if (capTimer) clearTimeout(capTimer);
    try {
      reader.releaseLock();
    } catch {
      // Already released (or cancelled) — either way the reader is done.
    }
  }
}

/**
 * Wrap an SSE body with a stall deadline (reset per chunk) and an absolute stream ceiling.
 *
 * The idle timer runs ONLY while a pull is awaiting the upstream. The relay is pull-based with
 * `highWaterMark: 0`, so `pull()` is invoked by a downstream `read()`: if the consumer stops
 * pulling (backpressure), no read is pending and the idle clock is stopped.
 *
 * @param body      upstream SSE body
 * @param idleMs    max silence between chunks, including the wait for the first chunk
 * @param ceilingMs max lifetime of the whole stream, regardless of liveness
 */
export function withChatDeadline(
  body: ReadableStream<Uint8Array>,
  idleMs: number = CHAT_STALL_TIMEOUT_MS,
  ceilingMs: number = CHAT_STREAM_CEILING_MS,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let ceilingTimer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;
  let fireTimeout: (() => void) | undefined;

  const timeout = new Promise<Deadline>((resolve) => {
    fireTimeout = () => {
      if (fired) return;
      fired = true;
      resolve("timeout");
    };
  });

  const clearIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  };

  const clearTimers = (): void => {
    clearIdle();
    if (ceilingTimer) clearTimeout(ceilingTimer);
    ceilingTimer = undefined;
  };

  // Armed only inside `pull()`, i.e. only while this consumer is waiting on an upstream chunk.
  const armIdle = (): void => {
    clearIdle();
    idleTimer = setTimeout(() => fireTimeout?.(), idleMs);
  };

  // Fixed from construction: chunks do NOT reset the absolute backstop. This is a backstop for the
  // whole relay, so it intentionally keeps running even while the consumer is backpressuring.
  ceilingTimer = setTimeout(() => fireTimeout?.(), ceilingMs);

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (fired) {
          // The ceiling elapsed while the consumer was not pulling (no read in flight). Surface the
          // timeout on resume, then drain the upstream in the background (bounded).
          clearTimers();
          controller.enqueue(chatTimeoutEvent());
          controller.close();
          void drainBounded(reader, reader.read(), ceilingMs);
          return;
        }

        const readPromise = reader.read();
        // Starts now: the consumer has asked for a chunk and we are awaiting the upstream.
        armIdle();
        const result = await Promise.race([readPromise, timeout]);
        // The wait is over (chunk, EOF, or deadline) — stop the stall clock. It is re-armed only by
        // the next pull(), which only happens when the consumer asks again.
        clearIdle();

        if (result === "timeout") {
          clearTimers();
          controller.enqueue(chatTimeoutEvent());
          controller.close();
          // Keep draining in the background — bounded — so the agent can complete and refund.
          void drainBounded(reader, readPromise, ceilingMs);
          return;
        }

        if (result.done) {
          clearTimers();
          controller.close();
          return;
        }

        controller.enqueue(result.value);
      },
      cancel(reason) {
        clearTimers();
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
