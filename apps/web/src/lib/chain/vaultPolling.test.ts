import assert from "node:assert/strict";
import { test } from "node:test";

import {
  VAULT_MAX_BACKOFF_MS,
  VAULT_MAX_CONSECUTIVE_FAILURES,
  VAULT_POLL_MS,
  vaultRefetchInterval,
} from "./vaultPolling.ts";

test("healthy reads poll once a minute, not every few seconds", () => {
  assert.equal(VAULT_POLL_MS, 60_000);
  assert.equal(vaultRefetchInterval(0), VAULT_POLL_MS);
  assert.equal(vaultRefetchInterval(-1), VAULT_POLL_MS);
});

test("consecutive failures back off exponentially", () => {
  assert.equal(vaultRefetchInterval(1), VAULT_POLL_MS * 2);
  assert.equal(vaultRefetchInterval(2), VAULT_POLL_MS * 4);
  assert.equal(vaultRefetchInterval(3), VAULT_POLL_MS * 8);
});

test("backoff is capped and then stops rather than hammering a broken RPC", () => {
  assert.equal(vaultRefetchInterval(VAULT_MAX_CONSECUTIVE_FAILURES - 1), VAULT_MAX_BACKOFF_MS);
  assert.equal(vaultRefetchInterval(VAULT_MAX_CONSECUTIVE_FAILURES), false);
  assert.equal(vaultRefetchInterval(99), false);
});
