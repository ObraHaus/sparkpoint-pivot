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

/** A clean §2.7 error block as an already-framed SSE event. */
export function chatTimeoutEvent(): Uint8Array {
  const block = JSON.stringify({
    type: "error",
    code: "UPSTREAM_UNAVAILABLE",
    message: "Sparky took too long to answer. Nothing was signed or changed — you can try again.",
  });
  return new TextEncoder().encode(`event: block\ndata: ${block}\n\n`);
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

  const clearTimers = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    if (ceilingTimer) clearTimeout(ceilingTimer);
    idleTimer = undefined;
    ceilingTimer = undefined;
  };

  // Re-armed after every upstream chunk (a heartbeat/comment chunk included).
  const armIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fireTimeout?.(), idleMs);
  };

  // Fixed from construction: chunks do NOT reset the absolute backstop.
  ceilingTimer = setTimeout(() => fireTimeout?.(), ceilingMs);
  armIdle();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const readPromise = reader.read();
      const result = await Promise.race([readPromise, timeout]);

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

      armIdle();
      controller.enqueue(result.value);
    },
    cancel(reason) {
      clearTimers();
      return reader.cancel(reason);
    },
  });
}
