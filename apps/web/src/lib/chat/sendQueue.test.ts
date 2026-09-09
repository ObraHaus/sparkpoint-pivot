import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDLE,
  QUEUE_CAP,
  decideSend,
  queueNotice,
  serialQueue,
  suggestionsVisible,
} from "./sendQueue.ts";

/* ── the decision ───────────────────────────────────────────────────────────── */

test("an idle chat sends immediately", () => {
  const d = decideSend("what are the fees?", IDLE);
  assert.equal(d.accepted, true);
  assert.equal(d.accepted && d.waits, false);
  assert.equal(d.accepted && d.text, "what are the fees?");
});

test("THE BUG — a message sent while one is in flight is accepted but does NOT go out now", () => {
  // This is the whole feature. Before it, `send()` called `sendLive()` unconditionally, so this
  // second message raced the first: in a new chat it forked its own conversation, and in an
  // existing one it read a history that did not yet contain the first message.
  const d = decideSend("and the APY?", { busy: true, queued: 0 });
  assert.equal(d.accepted, true, "the message is still taken — nothing the user typed is dropped");
  assert.equal(d.accepted && d.waits, true, "…but it waits its turn");
});

test("a message sent while others are already waiting also waits", () => {
  const d = decideSend("third", { busy: true, queued: 2 });
  assert.equal(d.accepted && d.waits, true);
});

test("a message typed while the queue is draining but nothing is in flight still waits", () => {
  // busy:false + queued>0 is the sliver between one turn finishing and the next starting. Sending
  // straight through it would put two turns in flight, which is the bug wearing a different hat.
  const d = decideSend("fourth", { busy: false, queued: 1 });
  assert.equal(d.accepted && d.waits, true);
});

test("whitespace is not a message", () => {
  assert.deepEqual(decideSend("   \n ", IDLE), { accepted: false, reason: "empty" });
  assert.deepEqual(decideSend("", { busy: true, queued: 1 }), { accepted: false, reason: "empty" });
});

test("the message is trimmed once, here, so every consumer gets the same text", () => {
  const d = decideSend("  explain the performance fee  ", IDLE);
  assert.equal(d.accepted && d.text, "explain the performance fee");
});

test("over the cap is refused OUT LOUD, never silently dropped", () => {
  const d = decideSend("one too many", { busy: true, queued: QUEUE_CAP });
  assert.equal(d.accepted, false);
  assert.equal(d.accepted === false && d.reason, "full");
  const notice = d.accepted === false && d.reason === "full" ? d.notice : "";
  assert.match(notice, new RegExp(String(QUEUE_CAP)), "the notice names the actual limit");
  assert.match(notice, /wasn’t added/, "and says plainly that this message was not taken");
});

test("the cap counts what is WAITING, so a full queue still drains", () => {
  // One in flight + CAP waiting is the ceiling; the in-flight one is not double-counted.
  assert.equal(decideSend("ok", { busy: true, queued: QUEUE_CAP - 1 }).accepted, true);
});

/* ── the chips ──────────────────────────────────────────────────────────────── */

test("THE OTHER BUG — no suggestions while a turn is in flight", () => {
  // Each chip IS a send(), so leaving them up during a turn was the product offering a way to fire
  // a parallel message. They are also answering the wrong question: chips suggest what to ask next,
  // and while the answer is still being written there is no "next" to suggest from yet.
  assert.equal(suggestionsVisible({ busy: true, queued: 0 }), false);
});

test("no suggestions while messages are still waiting", () => {
  assert.equal(suggestionsVisible({ busy: false, queued: 2 }), false);
  assert.equal(suggestionsVisible({ busy: true, queued: 2 }), false);
});

test("suggestions come back once everything has been answered", () => {
  assert.equal(suggestionsVisible(IDLE), true);
});

/* ── the notice ─────────────────────────────────────────────────────────────── */

test("the notice says how many are waiting, and says nothing when none are", () => {
  assert.equal(queueNotice(IDLE), null);
  assert.equal(queueNotice({ busy: true, queued: 0 }), null, "in flight is not 'waiting'");
  assert.match(queueNotice({ busy: true, queued: 1 })!, /^1 message waiting/);
  assert.match(queueNotice({ busy: true, queued: 3 })!, /^3 messages waiting/);
});

/* ── the runner ─────────────────────────────────────────────────────────────── */

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

test("THE GUARANTEE — never two at once, however fast they arrive", async () => {
  // The assertion the feature exists for, and the one a browser cannot make reliably: a counter
  // that must never reach two. Four sends land in the same tick, exactly as they do when someone
  // hits Enter four times.
  let inFlight = 0;
  let peak = 0;
  const order: string[] = [];
  const q = serialQueue<string>({
    run: async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      order.push(item);
      inFlight -= 1;
    },
  });

  q.push("a");
  q.push("b");
  q.push("c");
  q.push("d");

  while (q.snapshot().busy || q.snapshot().queued > 0) await tick();
  assert.equal(peak, 1, "two sends were in flight at once");
  assert.deepEqual(order, ["a", "b", "c", "d"], "and they must run in the order they were typed");
});

test("a push DURING a run joins the drain rather than starting a second one", async () => {
  let peak = 0;
  let inFlight = 0;
  const q = serialQueue<string>({
    run: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
    },
  });
  q.push("first");
  await tick(); // "first" is now mid-run
  q.push("second");
  while (q.snapshot().busy || q.snapshot().queued > 0) await tick();
  assert.equal(peak, 1);
});

test("the snapshot distinguishes in-flight from waiting", async () => {
  const gate: (() => void)[] = [];
  const q = serialQueue<string>({
    run: () => new Promise<void>((resolve) => gate.push(resolve)),
  });
  assert.deepEqual(q.snapshot(), IDLE);

  q.push("a");
  assert.deepEqual(q.snapshot(), { busy: true, queued: 0 }, "one running, none waiting");
  q.push("b");
  q.push("c");
  assert.deepEqual(q.snapshot(), { busy: true, queued: 2 });

  gate.shift()!();
  await tick();
  assert.deepEqual(q.snapshot(), { busy: true, queued: 1 });
});

test("onChange reports every transition, ending idle", async () => {
  const seen: string[] = [];
  const q = serialQueue<string>({
    run: async () => {
      await tick();
    },
    onChange: (s) => seen.push(`${s.busy ? "busy" : "idle"}:${s.queued}`),
  });
  q.push("a");
  q.push("b");
  while (q.snapshot().busy || q.snapshot().queued > 0) await tick();
  assert.equal(seen.at(-1), "idle:0", "the composer must not be left thinking it is busy");
  assert.ok(seen.includes("busy:1"), "…and must have seen the moment one was waiting");
});

test("a failure HALTS the queue and hands back what it never started", async () => {
  const ran: string[] = [];
  let halted: { remaining: string[]; error: unknown } | null = null;
  const q = serialQueue<string>({
    run: async (item) => {
      await tick();
      if (item === "b") throw new Error("assistant unavailable");
      ran.push(item);
    },
    onHalted: (remaining, error) => {
      halted = { remaining, error };
    },
  });
  q.push("a");
  q.push("b");
  q.push("c");
  q.push("d");
  while (q.snapshot().busy || q.snapshot().queued > 0) await tick();
  await tick();

  assert.deepEqual(ran, ["a"], "nothing after the failure was sent");
  const h = halted as { remaining: string[]; error: unknown } | null;
  assert.ok(h, "the halt was reported");
  assert.deepEqual(h!.remaining, ["c", "d"], "the unsent messages come back — they are not lost");
  assert.match(String((h!.error as Error).message), /unavailable/);
});

test("the queue is idle by the time the halt is reported, so a retry can drain", async () => {
  // If `onHalted` fired while the drain still believed it was running, anything pushed from it
  // would sit in the queue forever.
  const ran: string[] = [];
  let attempt = 0;
  const q = serialQueue<string>({
    run: async (item) => {
      await tick();
      attempt += 1;
      if (attempt === 1) throw new Error("first attempt fails");
      ran.push(item);
    },
    onHalted: (remaining) => {
      assert.equal(q.snapshot().busy, false, "the queue must be idle when the halt is reported");
      remaining.forEach((r) => q.push(r)); // a caller offering "send them anyway"
    },
  });
  q.push("a");
  q.push("b");
  while (q.snapshot().busy || q.snapshot().queued > 0) await tick();
  await tick();
  while (q.snapshot().busy || q.snapshot().queued > 0) await tick();
  assert.deepEqual(ran, ["b"], "the re-queued message actually ran");
});

test("clear() drops what is waiting and leaves the one in flight alone", async () => {
  const ran: string[] = [];
  const gate: (() => void)[] = [];
  const q = serialQueue<string>({
    run: (item) =>
      new Promise<void>((resolve) =>
        gate.push(() => {
          ran.push(item);
          resolve();
        }),
      ),
  });
  q.push("a");
  q.push("b");
  q.push("c");

  // Switching conversations must not carry queued messages into the new thread — they were typed
  // at a different conversation and would be answered in the wrong one.
  assert.deepEqual(q.clear(), ["b", "c"]);
  assert.deepEqual(q.snapshot(), { busy: true, queued: 0 });

  gate.shift()!();
  while (q.snapshot().busy) await tick();
  assert.deepEqual(ran, ["a"], "the in-flight send was not cancelled by clear()");
});

test("clear() on an idle queue is a no-op", () => {
  const q = serialQueue<string>({ run: async () => {} });
  assert.deepEqual(q.clear(), []);
  assert.deepEqual(q.snapshot(), IDLE);
});
