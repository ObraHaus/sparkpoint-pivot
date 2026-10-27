import assert from "node:assert/strict";
import { test } from "node:test";

import { withChatDeadline } from "./chatStreamDeadline.ts";

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

test("a chunk every 20s for 120s completes — the deadline measures silence, not total time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reading = readAll(wrapped);

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

test("the background drain is bounded and the reader is released at the cap", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const src = source();
  const wrapped = withChatDeadline(src.stream, IDLE_MS, CEILING_MS);
  const reading = readAll(wrapped);

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
