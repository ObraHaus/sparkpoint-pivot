import test from "node:test";
import assert from "node:assert/strict";

import {
  SolanaRpcTimeoutError,
  solanaProxyRpcUrl,
  withTimeout,
} from "./clientRpc.ts";

test("the browser talks to the same-origin Solana RPC proxy", () => {
  assert.equal(solanaProxyRpcUrl("https://beta.sparkpoint.io"), "https://beta.sparkpoint.io/api/solana/rpc");
  assert.equal(solanaProxyRpcUrl("https://beta.sparkpoint.io/"), "https://beta.sparkpoint.io/api/solana/rpc");
  assert.equal(solanaProxyRpcUrl(""), "/api/solana/rpc");
});

test("withTimeout resolves when the promise settles first", async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 50), 42);
});

test("withTimeout rejects a hanging read instead of spinning forever", async () => {
  await assert.rejects(
    withTimeout(new Promise<never>(() => {}), 5, "Reading your wallet balance timed out."),
    (error: unknown) =>
      error instanceof SolanaRpcTimeoutError &&
      error.message === "Reading your wallet balance timed out.",
  );
});
