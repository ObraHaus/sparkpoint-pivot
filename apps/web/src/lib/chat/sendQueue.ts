/**
 * 041 — one turn at a time.
 *
 * THE BUG THIS EXISTS TO PREVENT. `send()` fired `sendLive()` with no regard for whether a turn
 * was already in flight, so a second message went out in parallel with the first. Two things
 * followed, and the worse one is invisible:
 *
 *  1. IN A NEW CHAT, EVERY PARALLEL SEND FORKS ITS OWN CONVERSATION. The client only learns the
 *     conversation id from the terminal `done` frame of the FIRST stream. Until then it sends
 *     `conversationId: undefined`, and the agent's `ensure_conversation` treats a missing id as
 *     "create one". Three quick messages in a fresh chat therefore became three separate threads,
 *     each titled after its own message — which is also why the sidebar can show the same title
 *     several times over.
 *  2. IN AN EXISTING CHAT, THE TURNS INTERLEAVE. Both requests read the history before either had
 *     written to it, so neither saw the other's message, and the rows land in completion order:
 *     `user A, user B, answer B, answer A`. Replayed newest-id-last, that is a transcript in which
 *     the answers are attached to the wrong questions.
 *
 * Serialising the sends fixes both at the root: message two starts only after message one's `done`
 * frame has set the conversation id, so it joins the thread instead of forking it.
 *
 * PURE and LEAF: no React, no imports. The concurrency guarantee is the whole point of the feature
 * and it is exactly the kind of thing a browser cannot be made to assert reliably — here it is a
 * counter that must never exceed one.
 */

/** What the composer knows about the queue at this instant. */
export interface QueueSnapshot {
  /** A message is being sent right now. */
  readonly busy: boolean;
  /** How many are waiting behind it. */
  readonly queued: number;
}

export const IDLE: QueueSnapshot = { busy: false, queued: 0 };

/**
 * How many messages may wait behind the one in flight.
 *
 * A bound, not a guess: each queued message is a real request that will be made, and the free model
 * pool already saturates under rapid-fire load. Four is more than anyone types ahead on purpose and
 * few enough that a stuck queue cannot become a burst. Going over is REFUSED OUT LOUD — silently
 * dropping what someone typed is the one outcome worse than making them wait.
 */
export const QUEUE_CAP = 4;

export type SendDecision =
  | { accepted: false; reason: "empty" }
  | { accepted: false; reason: "full"; notice: string }
  /** `waits` is true when something is already in flight — the message is accepted, not sent yet. */
  | { accepted: true; text: string; waits: boolean };

/** Whether a submitted message is taken, and whether it goes out now or waits its turn. */
export function decideSend(raw: string, q: QueueSnapshot): SendDecision {
  const text = raw.trim();
  if (!text) return { accepted: false, reason: "empty" };
  if (q.queued >= QUEUE_CAP) {
    return {
      accepted: false,
      reason: "full",
      notice: `${QUEUE_CAP} messages are already waiting. They send one at a time — this one wasn’t added.`,
    };
  }
  return { accepted: true, text, waits: q.busy || q.queued > 0 };
}

/**
 * Whether the suggested-prompt chips may be shown.
 *
 * They are hidden the moment anything is in flight or waiting. The chips are not decoration — each
 * one is a `send()`, so leaving them up during a turn was itself a way to fire a parallel message,
 * offered by the product. They also answer the wrong question: chips suggest what to ask NEXT, and
 * while an answer is still being written there is no "next" yet to suggest from.
 */
export function suggestionsVisible(q: QueueSnapshot): boolean {
  return !q.busy && q.queued === 0;
}

/** The line above the composer while messages are waiting, or `null` when none are. */
export function queueNotice(q: QueueSnapshot): string | null {
  if (q.queued <= 0) return null;
  if (q.queued === 1) return "1 message waiting — it sends when this answer finishes";
  return `${q.queued} messages waiting — they send one at a time`;
}

/* ── the runner ─────────────────────────────────────────────────────────────── */

export interface SerialQueue<T> {
  /** Take an item. Starts it immediately if nothing is running, otherwise queues it. */
  push(item: T): void;
  /** Drop everything still waiting and return it. Does NOT touch the item already running. */
  clear(): T[];
  snapshot(): QueueSnapshot;
}

export interface SerialQueueOptions<T> {
  run: (item: T) => Promise<void>;
  onChange?: (snapshot: QueueSnapshot) => void;
  /**
   * An item threw, so the queue stopped and handed back everything it had not started.
   *
   * Halting rather than ploughing on is deliberate. A failure here almost always means the
   * assistant is unreachable, and draining three more messages into the same wall produces three
   * more identical error cards and three more doomed requests. The remaining messages are not lost
   * — they come back through here so the caller can show them as unsent and offer to send them.
   */
  onHalted?: (remaining: T[], error: unknown) => void;
}

/**
 * Runs items one at a time, in order, for as long as items keep arriving.
 *
 * The guarantee rests on `drain()` being entered synchronously: an async function body runs up to
 * its first `await` before yielding, so the `if (running) return` guard is evaluated before any
 * caller can interleave. That is what makes a push during a run join the existing drain instead of
 * starting a second one.
 */
export function serialQueue<T>({ run, onChange, onHalted }: SerialQueueOptions<T>): SerialQueue<T> {
  const pending: T[] = [];
  let running = false;

  const notify = () => onChange?.({ busy: running, queued: pending.length });

  async function drain(): Promise<void> {
    if (running) return; // evaluated synchronously — see the note above
    running = true;
    notify();
    // Captured, not reported here: `onHalted` fires only once the queue is fully idle, so a caller
    // that responds to a failure by re-queueing gets a fresh drain rather than a push into a queue
    // that still believes it is running.
    let halted: { remaining: T[]; error: unknown } | null = null;
    try {
      for (;;) {
        const next = pending.shift();
        if (next === undefined) break;
        notify();
        try {
          await run(next);
        } catch (error) {
          halted = { remaining: pending.splice(0, pending.length), error };
          break;
        }
      }
    } finally {
      running = false;
      notify();
    }
    if (halted) onHalted?.(halted.remaining, halted.error);
  }

  return {
    push(item: T) {
      pending.push(item);
      notify();
      void drain();
    },
    clear() {
      const dropped = pending.splice(0, pending.length);
      notify();
      return dropped;
    },
    snapshot() {
      return { busy: running, queued: pending.length };
    },
  };
}
