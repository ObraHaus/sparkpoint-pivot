import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NULL_BODY_STATUSES,
  bufferedUpstreamResponse,
  isNullBodyStatus,
  nullBodyResponse,
  sseUpstreamResponse,
} from "./proxyResponse.ts";

/**
 * 064 — the BFF must pass 204 No Content through without constructing a Response with a body.
 * `new Response(buffer, { status: 204 })` throws `TypeError: Invalid response status code 204`,
 * which turned a successful thumbs-feedback POST into a browser-visible 500.
 */

const encoder = new TextEncoder();

test("null-body statuses are exactly the Fetch null-body set", () => {
  assert.deepEqual([...NULL_BODY_STATUSES], [101, 103, 204, 205, 304]);
  for (const status of NULL_BODY_STATUSES) assert.equal(isNullBodyStatus(status), true);
  for (const status of [200, 201, 206, 400, 500]) assert.equal(isNullBodyStatus(status), false);
});

test("buffered 204 returns 204 with an empty/null body and no content headers", async () => {
  const res = bufferedUpstreamResponse({
    status: 204,
    body: new ArrayBuffer(0),
    // Some upstreams are sloppy and still send these; neither may describe a phantom body.
    contentType: "application/json",
    retryAfter: null,
  });

  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.equal(res.headers.get("content-type"), null);
  assert.equal(res.headers.get("content-length"), null);
  assert.equal(await res.text(), "");
});

test("buffered 204 drops a non-empty buffer instead of passing it to the constructor", async () => {
  const res = bufferedUpstreamResponse({
    status: 204,
    body: encoder.encode('{"stored":true}').buffer as ArrayBuffer,
  });

  assert.equal(res.status, 204);
  assert.equal(res.body, null);
  assert.equal(await res.text(), "");
});

test("nullBodyResponse strips a caller-supplied content-length", () => {
  const res = nullBodyResponse(204, {
    "content-type": "application/json",
    "content-length": "12",
    "x-test": "kept",
  });

  assert.equal(res.body, null);
  assert.equal(res.headers.get("content-length"), null);
  assert.equal(res.headers.get("content-type"), null);
  assert.equal(res.headers.get("x-test"), "kept");
});

test("buffered 200 JSON is relayed unchanged", async () => {
  const body = encoder.encode('{"ok":true,"count":2}').buffer as ArrayBuffer;
  const res = bufferedUpstreamResponse({
    status: 200,
    body,
    contentType: "application/json",
    retryAfter: "30",
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("retry-after"), "30");
  assert.deepEqual(await res.json(), { ok: true, count: 2 });
});

test("buffered non-2xx JSON keeps its status and envelope body", async () => {
  const envelope = '{"error":{"code":"RATE_LIMITED","httpStatus":429}}';
  const res = bufferedUpstreamResponse({
    status: 429,
    body: encoder.encode(envelope).buffer as ArrayBuffer,
    contentType: "application/json",
    retryAfter: "60",
  });

  assert.equal(res.status, 429);
  assert.equal(res.headers.get("retry-after"), "60");
  assert.equal(await res.text(), envelope);
});

test("SSE passthrough keeps its status, headers and stream contents", async () => {
  const chunks = ["event: block\ndata: {\"type\":\"text\"}\n\n", "event: done\ndata: {}\n\n"];
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const res = sseUpstreamResponse(source, 200);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/event-stream");
  assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(res.headers.get("connection"), "keep-alive");
  assert.equal(res.headers.get("x-accel-buffering"), "no");
  assert.equal(res.headers.get("content-encoding"), "identity");
  assert.equal(await res.text(), chunks.join(""));
});
