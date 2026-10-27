import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyChatStreamDeadline,
  isChatStreamPath,
  withChatConnectDeadline,
  withChatDeadline,
} from "./chatStreamDeadline.ts";

/**
 * Fake-timer tests for the BFF chat stream deadline.
 *
 * The contract is STALL time, not total time: a stream that keeps producing may run for as long as
 * its absolute ceiling allows, while a silent one is cut off at the idle bound. Node's built-in
 * mock timers are the fake-timer implementation this repo's `node --test` runner uses.
 */

const IDLE_MS = 60_000;
const CEILING_MS = 5 * 60_000;

interface Source {
  stream: ReadableStream<Uint8Array>;
  push(text: string): void;
  close(): void;
  readonly cancelled: boolean;
}

function source(): Source {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    stream,
    push(text) {
      controller.enqueue(encoder.encode(text));
    },
    close() {
      controller.close();
    },
    get cancelled() {
      return cancelled;
    },
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value, { stream: true });
  }
}

/* ── path scoping (OH Defender MEDIUM) ─────────────────────────────────────── */

test("only the exact /chat path is scoped — lookalikes are not", () => {
  assert.equal(isChatStreamPath(["chat"]), true);
  // Not by substring/prefix: an exact segment match only.
  assert.equal(isChatStreamPath(["chat", "feedback"]), false);
  assert.equal(isChatStreamPath(["onboarding", "turn"]), false);
  assert.equal(isChatStreamPath(["admin", "chat"]), false);
  assert.equal(isChatStreamPath(["chatter"]), false);
  assert.equal(isChatStreamPath([]), false);
});

test("a non-chat route is not wrapped — a 90s slow response is not cut", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const relayed = applyChatStreamDeadline(["portfolio"], src.stream, IDLE_MS, CEILING_MS);
  // Identity: the upstream body is relayed untouched, so no timer can fire.
  assert.equal(relayed, src.stream);

  const reading = readAll(relayed);
  await flush();
  // Longer than both the idle bound and the old response-headers deadline.
  t.mock.timers.tick(90_000);
  await flush();
  src.push("late-but-fine");
  src.close();
  await flush();

  assert.equal(await reading, "late-but-fine");
  assert.equal(src.cancelled, false);
});

test("the response-headers/connect deadline is armed for /chat only", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const request = new AbortController();

  const nonChat = withChatConnectDeadline(["portfolio"], request.signal, IDLE_MS);
  t.mock.timers.tick(90_000);
  assert.equal(nonChat.signal.aborted, false, "non-chat routes keep origin/main behaviour");
  nonChat.clear();

  const chat = withChatConnectDeadline(["chat"], request.signal, IDLE_MS);
  t.mock.timers.tick(IDLE_MS + 1);
  assert.equal(chat.signal.aborted, true, "chat still gets its first-byte/headers bound");
  chat.clear();
});

/* ── the chat deadline behaviour ───────────────────────────────────────────── */

test("a chunk every 20s for 120s completes — the deadline measures silence, not total time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reading = readAll(wrapped);

  await flush(); // first pull is in flight, idle clock running
  for (let i = 0; i < 6; i += 1) {
    t.mock.timers.tick(20_000);
    src.push(`chunk-${i}`);
    await flush();
  }
  src.close();
  await flush();

  assert.equal(await reading, "chunk-0chunk-1chunk-2chunk-3chunk-4chunk-5");
  assert.equal(src.cancelled, false);
});

test("a 61s silence after a first chunk errors with the honest UPSTREAM_UNAVAILABLE block", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reading = readAll(wrapped);

  await flush();
  src.push("data: first-byte\n\n");
  await flush();
  t.mock.timers.tick(61_000);
  await flush();

  const out = await reading;
  assert.match(out, /^data: first-byte/);
  assert.match(out, /event: block/);
  assert.match(out, /UPSTREAM_UNAVAILABLE/);
  // Still draining (no BFF cancel), so Retry cannot double-charge the turn.
  assert.equal(src.cancelled, false);
});

test("the time-to-first-byte timeout still fires — no first chunk, no answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reading = readAll(wrapped);

  await flush();
  t.mock.timers.tick(60_001);
  await flush();

  const out = await reading;
  assert.match(out, /event: block/);
  assert.match(out, /UPSTREAM_UNAVAILABLE/);
});

test("the absolute ceiling cuts off a chatty stream that never finishes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reading = readAll(wrapped);

  await flush();
  // A keepalive every 20s never trips the idle deadline, so only the ceiling can stop it.
  for (let elapsed = 0; elapsed < CEILING_MS; elapsed += 20_000) {
    t.mock.timers.tick(20_000);
    src.push(": keepalive\n\n");
    await flush();
  }
  t.mock.timers.tick(20_000);
  await flush();

  const out = await reading;
  assert.match(out, /UPSTREAM_UNAVAILABLE/);
});

test("keepalives reset the idle deadline (a 50s gap each time is not a stall)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reading = readAll(wrapped);

  await flush();
  for (let i = 0; i < 5; i += 1) {
    t.mock.timers.tick(50_000);
    src.push(": keepalive\n\n");
    await flush();
  }
  src.close();
  await flush();

  const out = await reading;
  assert.match(out, /keepalive/);
  assert.doesNotMatch(out, /UPSTREAM_UNAVAILABLE/);
});

test("a consumer pausing 120s (backpressure) then resuming is NOT timed out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reader = wrapped.getReader();
  const decoder = new TextDecoder();

  src.push("first");
  await flush();
  const first = await reader.read();
  assert.equal(decoder.decode(first.value, { stream: true }), "first");

  // Stop reading for two full idle windows: no `pull()` is in flight, so no stall clock runs.
  t.mock.timers.tick(120_000);
  await flush();

  src.push("second");
  const second = await reader.read();
  assert.equal(decoder.decode(second.value, { stream: true }), "second");

  src.close();
  const done = await reader.read();
  assert.equal(done.done, true);
});

test("the background drain is bounded and the reader is released at the cap", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reading = readAll(wrapped);

  await flush();
  t.mock.timers.tick(60_001);
  await flush();
  const out = await reading;
  assert.match(out, /UPSTREAM_UNAVAILABLE/);
  assert.equal(src.cancelled, false, "must keep draining while the agent may still finish");

  // The agent never finishes: after the bounded grace window the upstream is released.
  t.mock.timers.tick(CEILING_MS);
  await flush();
  assert.equal(src.cancelled, true);
});
