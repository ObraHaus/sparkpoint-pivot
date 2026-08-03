import assert from "node:assert/strict";
import { test } from "node:test";

import { chatErrorCopy, isInternalEnvelope } from "./chatError.ts";

/** The exact string the Aug-3 regression saw rendered as Sparky's reply. */
const LIVE_LEAK = "X-Account/X-Owner/X-Chain-Id are malformed or mismatched.";

test("the header-validation string the client actually saw is classified internal", () => {
  assert.equal(isInternalEnvelope(LIVE_LEAK), true);
  assert.equal(isInternalEnvelope(LIVE_LEAK, "ACCOUNT_HEADERS_INVALID"), true);
});

test("an internal envelope is NEVER echoed verbatim to the user", () => {
  const view = chatErrorCopy(LIVE_LEAK, "ACCOUNT_HEADERS_INVALID");
  assert.ok(!view.message.includes("X-Account"));
  assert.ok(!view.message.includes("malformed"));
  assert.ok(/nothing was signed/i.test(view.message), "must reassure about funds");
  assert.equal(view.retryable, true);
});

test("other plumbing shapes are caught too", () => {
  for (const s of [
    "Traceback (most recent call last): ...",
    "'NoneType' object has no attribute 'get'",
    'requestId req_8e5795549a55441880143c3939d969ad',
    "policyVersion policy@2026.06.0",
    "",
    "   ",
  ]) {
    assert.equal(isInternalEnvelope(s), true, s);
  }
});

test("messages WRITTEN for users pass through untouched", () => {
  const quota = "You've reached today's free limit for the AI assistant. It resets tomorrow.";
  assert.equal(chatErrorCopy(quota, "RATE_LIMITED").message, quota);
  assert.equal(chatErrorCopy(quota, "RATE_LIMITED").retryable, false);

  const auth = "Sign in with your wallet to use the assistant.";
  assert.equal(chatErrorCopy(auth, "UNAUTHENTICATED").message, auth);

  const upstream = "The assistant hit a problem completing that turn. Nothing was signed.";
  assert.equal(chatErrorCopy(upstream, "UPSTREAM_UNAVAILABLE").message, upstream);
});

test("an empty upstream failure still says something honest and retryable", () => {
  const view = chatErrorCopy("", "UPSTREAM_UNAVAILABLE");
  assert.ok(view.message.length > 0);
  assert.equal(view.retryable, true);
  assert.ok(!/error|exception/i.test(view.message), "plain language, not error-speak");
});

test("no copy blames the user for our defect", () => {
  for (const code of ["ACCOUNT_HEADERS_INVALID", "INTERNAL", "VALIDATION_ERROR"]) {
    const { message } = chatErrorCopy(LIVE_LEAK, code);
    assert.ok(!/your (connection|browser|wallet) (is|was)/i.test(message));
  }
});
