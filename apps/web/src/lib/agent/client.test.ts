import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgentClient } from "./client.ts";

/**
 * 064 — `AgentClient.request` must treat 204/205 as "no content": return `undefined` without
 * trying to parse a JSON body. The thumbs-feedback POST is exactly this shape.
 */

const IDENTITY = {
  account: "0x0000000000000000000000000000000000000001",
  owner: "0x0000000000000000000000000000000000000002",
  chainId: 8453,
} as const;

function withFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test("request returns undefined for 204 without reading or parsing a body", async () => {
  let bodyReads = 0;
  const restore = withFetch((async () => ({
    ok: true,
    status: 204,
    statusText: "No Content",
    headers: new Headers(),
    text: async () => {
      bodyReads += 1;
      return "";
    },
    json: async () => {
      bodyReads += 1;
      return {};
    },
  })) as unknown as typeof fetch);

  try {
    const client = createAgentClient({ identity: IDENTITY });
    const result = await client.request("/chat/feedback", {
      method: "POST",
      body: { conversationId: "c1", blockId: "m1", rating: "up" },
    });

    assert.equal(result, undefined);
    assert.equal(bodyReads, 0, "a 204 has no body to parse");
  } finally {
    restore();
  }
});

test("request returns undefined for 205 without parsing", async () => {
  const restore = withFetch((async () => ({
    ok: true,
    status: 205,
    statusText: "Reset Content",
    headers: new Headers(),
    text: async () => {
      throw new Error("must not read a 205 body");
    },
    json: async () => {
      throw new Error("must not parse a 205 body");
    },
  })) as unknown as typeof fetch);

  try {
    const client = createAgentClient({ identity: IDENTITY });
    assert.equal(await client.request("/chat/feedback"), undefined);
  } finally {
    restore();
  }
});

test("request still parses a 200 JSON body unchanged", async () => {
  const restore = withFetch(
    (async () =>
      new Response(JSON.stringify({ ok: true, stored: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  );

  try {
    const client = createAgentClient({ identity: IDENTITY });
    assert.deepEqual(await client.request("/chat/feedback"), { ok: true, stored: 1 });
  } finally {
    restore();
  }
});
