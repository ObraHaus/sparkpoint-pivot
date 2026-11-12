import test from "node:test";
import assert from "node:assert/strict";

import {
  ALLOWED_SOLANA_RPC_METHODS,
  SOLANA_PUBLICNODE_RPC,
  proxySolanaRpc,
  solanaRpcUrls,
} from "./rpcProxy.ts";
import { SOLANA_MAINNET_RPC } from "../earn/kaminoLive.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(
  handler: (url: string, init: RequestInit) => Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof fetch;
}

const BALANCE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  result: { context: { slot: 123 }, value: 1_500_000_000 },
};

test("the allowlist only exposes the methods the Kamino flow needs", () => {
  assert.deepEqual(
    [...ALLOWED_SOLANA_RPC_METHODS].sort(),
    [
      "getAccountInfo",
      "getBalance",
      "getBlockHeight",
      "getLatestBlockhash",
      "getRecentPrioritizationFees",
      "getSignatureStatuses",
      "getTokenAccountsByOwner",
      "sendTransaction",
      "simulateTransaction",
    ],
  );
});

test("the upstream list prefers SOLANA_RPC_URL, then public mainnet, then publicnode", () => {
  assert.deepEqual(solanaRpcUrls({}), [SOLANA_MAINNET_RPC, SOLANA_PUBLICNODE_RPC]);
  assert.deepEqual(solanaRpcUrls({ SOLANA_RPC_URL: " https://rpc.example " }), [
    "https://rpc.example",
    SOLANA_MAINNET_RPC,
    SOLANA_PUBLICNODE_RPC,
  ]);
  assert.deepEqual(solanaRpcUrls({ SOLANA_RPC_URL: SOLANA_MAINNET_RPC }), [
    SOLANA_MAINNET_RPC,
    SOLANA_PUBLICNODE_RPC,
  ]);
});

test("malformed bodies are rejected with 400 before any upstream call", async () => {
  let calls = 0;
  const deps = {
    fetchImpl: fakeFetch(async () => {
      calls += 1;
      return jsonResponse(BALANCE_BODY);
    }),
    upstreams: ["https://rpc.example"],
  };
  const bodies = [
    null,
    [],
    {},
    { id: 1, params: [] },
    { jsonrpc: "2.0", id: 1, method: 42, params: [] },
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: {} },
    { jsonrpc: "2.0", method: "getBalance", params: [] },
  ];
  for (const body of bodies) {
    const result = await proxySolanaRpc(body, deps);
    assert.equal(result.status, 400);
    assert.equal((result.body.error as { code: string }).code, "invalid_request");
  }
  assert.equal(calls, 0);
});

test("unknown methods are refused", async () => {
  let calls = 0;
  const deps = {
    fetchImpl: fakeFetch(async () => {
      calls += 1;
      return jsonResponse(BALANCE_BODY);
    }),
    upstreams: ["https://rpc.example"],
  };
  for (const method of ["requestAirdrop", "getBalanceButPlease", "sendRawTransaction"]) {
    const result = await proxySolanaRpc(
      { jsonrpc: "2.0", id: 1, method, params: [] },
      deps,
    );
    assert.equal(result.status, 403);
    assert.equal((result.body.error as { code: string }).code, "method_not_allowed");
  }
  assert.equal(calls, 0);
});

test("a sendTransaction preflight error (-32002) is returned verbatim, not retried elsewhere", async () => {
  const preflightError = {
    jsonrpc: "2.0",
    id: 1,
    error: {
      code: -32002,
      message: "Transaction simulation failed: Error processing Instruction 3: custom program error",
      data: {
        err: { InstructionError: [3, { Custom: 6001 }] },
        logs: ["Program log: insufficient funds"],
      },
    },
  };
  const calls: string[] = [];
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AA==", { encoding: "base64" }] },
    {
      fetchImpl: fakeFetch(async (url) => {
        calls.push(url);
        return jsonResponse(preflightError);
      }),
      upstreams: ["https://first.example", "https://second.example"],
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, preflightError);
  assert.deepEqual(calls, ["https://first.example"]);
});

test("a simulateTransaction -32002 error is passed through too", async () => {
  const body = {
    jsonrpc: "2.0",
    id: 7,
    error: { code: -32002, message: "Transaction simulation failed", data: { err: "BlockhashNotFound" } },
  };
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 7, method: "simulateTransaction", params: ["AA==", { encoding: "base64" }] },
    {
      fetchImpl: fakeFetch(async () => jsonResponse(body)),
      upstreams: ["https://first.example", "https://second.example"],
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, body);
});

test("a sendTransaction preflight error is logged once on one line, without tx bytes", async () => {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    error: {
      code: -32002,
      message: "Transaction simulation failed",
      data: {
        err: { InstructionError: [4, { Custom: 6001 }] },
        logs: Array.from({ length: 12 }, (_, index) => `Program log: line ${index}`),
      },
    },
  };
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const result = await proxySolanaRpc(
      { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["SECRET_TX_BYTES", { encoding: "base64" }] },
      {
        fetchImpl: fakeFetch(async () => jsonResponse(body)),
        upstreams: ["https://rpc.example"],
      },
    );
    assert.deepEqual(result.body, body);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /sendTransaction/);
  assert.match(warnings[0] ?? "", /code=-32002/);
  assert.match(warnings[0] ?? "", /data\.err=.*InstructionError/);
  assert.match(warnings[0] ?? "", /Program log: line 11/);
  assert.equal((warnings[0] ?? "").includes("SECRET_TX_BYTES"), false);
  assert.equal((warnings[0] ?? "").includes("\n"), false);
});

test("a simulateTransaction value.err is logged too", async () => {
  const body = {
    jsonrpc: "2.0",
    id: 7,
    result: {
      value: {
        err: "BlockhashNotFound",
        logs: ["Blockhash not found"],
      },
    },
  };
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const result = await proxySolanaRpc(
      { jsonrpc: "2.0", id: 7, method: "simulateTransaction", params: ["AA==", { encoding: "base64" }] },
      {
        fetchImpl: fakeFetch(async () => jsonResponse(body)),
        upstreams: ["https://rpc.example"],
      },
    );
    assert.deepEqual(result.body, body);
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /simulateTransaction/);
  assert.match(warnings[0] ?? "", /data\.err=BlockhashNotFound/);
});

test("sendTransaction still falls back to the next upstream on a network failure", async () => {
  const calls: string[] = [];
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AA=="] },
    {
      fetchImpl: fakeFetch(async (url) => {
        calls.push(url);
        if (url === "https://first.example") throw new Error("network down");
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: "5" + "x".repeat(87) });
      }),
      upstreams: ["https://first.example", "https://second.example"],
    },
  );
  assert.equal(result.status, 200);
  assert.equal((result.body as { result: string }).result.length, 88);
  assert.deepEqual(calls, ["https://first.example", "https://second.example"]);
});

test("a successful getBalance is mapped through unchanged", async () => {
  const calls: string[] = [];
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: ["11111111111111111111111111111111"] },
    {
      fetchImpl: fakeFetch(async (url) => {
        calls.push(url);
        return jsonResponse(BALANCE_BODY);
      }),
      upstreams: ["https://rpc.example"],
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, BALANCE_BODY);
  assert.deepEqual(calls, ["https://rpc.example"]);
});

test("uses SOLANA_RPC_URL as the first upstream when it is set", async () => {
  const calls: string[] = [];
  const upstreams = solanaRpcUrls({ SOLANA_RPC_URL: "https://rpc.example" });
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] },
    {
      fetchImpl: fakeFetch(async (url) => {
        calls.push(url);
        return jsonResponse(BALANCE_BODY);
      }),
      upstreams,
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ["https://rpc.example"]);
});

test("falls back to the next upstream after an HTTP failure", async () => {
  const calls: string[] = [];
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] },
    {
      fetchImpl: fakeFetch(async (url) => {
        calls.push(url);
        if (url === "https://first.example") return jsonResponse({}, 500);
        return jsonResponse(BALANCE_BODY);
      }),
      upstreams: ["https://first.example", "https://second.example"],
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, BALANCE_BODY);
  assert.deepEqual(calls, ["https://first.example", "https://second.example"]);
});

test("falls back after a network error or timeout", async () => {
  const calls: string[] = [];
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] },
    {
      timeoutMs: 10,
      fetchImpl: fakeFetch(async (url) => {
        calls.push(url);
        if (url === "https://hang.example") return new Promise<Response>(() => {});
        if (url === "https://throw.example") throw new Error("network down");
        return jsonResponse(BALANCE_BODY);
      }),
      upstreams: ["https://hang.example", "https://throw.example", "https://second.example"],
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, BALANCE_BODY);
  assert.deepEqual(calls, ["https://hang.example", "https://throw.example", "https://second.example"]);
});

test("falls back when an upstream returns an unusable JSON-RPC error", async () => {
  const calls: string[] = [];
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] },
    {
      fetchImpl: fakeFetch(async (url) => {
        calls.push(url);
        if (url === "https://first.example") {
          return jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32603, message: "internal error" } });
        }
        return jsonResponse(BALANCE_BODY);
      }),
      upstreams: ["https://first.example", "https://second.example"],
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, BALANCE_BODY);
  assert.deepEqual(calls, ["https://first.example", "https://second.example"]);
});

test("a normal JSON-RPC error is passed through to the caller", async () => {
  const errorBody = {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32602, message: "Invalid param: not a PublicKey" },
  };
  const calls: string[] = [];
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: ["bad"] },
    {
      fetchImpl: fakeFetch(async (url) => {
        calls.push(url);
        return jsonResponse(errorBody);
      }),
      upstreams: ["https://first.example", "https://second.example"],
    },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, errorBody);
  assert.deepEqual(calls, ["https://first.example"]);
});

test("all upstreams failing returns a 502 rpc_unavailable error", async () => {
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] },
    {
      timeoutMs: 5,
      fetchImpl: fakeFetch(async () => {
        throw new Error("network down");
      }),
      upstreams: ["https://first.example", "https://second.example"],
    },
  );
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, {
    error: {
      code: "rpc_unavailable",
      message: "The Solana RPC upstreams could not be reached; your balance was not read.",
    },
  });
});

test("a hanging single upstream times out as a 502 rather than hanging forever", async () => {
  const result = await proxySolanaRpc(
    { jsonrpc: "2.0", id: 1, method: "getBalance", params: [] },
    {
      timeoutMs: 5,
      fetchImpl: fakeFetch(async () => new Promise<Response>(() => {})),
      upstreams: ["https://hang.example"],
    },
  );
  assert.equal(result.status, 502);
  assert.equal((result.body.error as { code: string }).code, "rpc_unavailable");
});
