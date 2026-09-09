import assert from "node:assert/strict";
import { test } from "node:test";

import { chatErrorCopy, isInternalEnvelope, turnCanRetry } from "./chatError.ts";

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

test("infrastructure vocabulary is replaced with something a user can act on", () => {
  // Observed live during the 029 verification run — rendered as the assistant's whole answer.
  const live = "The vault RPC is unreachable; the quote is temporarily unavailable (retryable).";
  assert.equal(isInternalEnvelope(live, "UPSTREAM_UNAVAILABLE"), true);
  const view = chatErrorCopy(live, "UPSTREAM_UNAVAILABLE");
  assert.ok(!/rpc/i.test(view.message), view.message);
  assert.ok(!/retryable/i.test(view.message), "don't hand the user our jargon for 'try again'");
  assert.ok(/nothing was signed/i.test(view.message));
  assert.equal(view.retryable, true);
});

test("an honest refusal written for users still passes through", () => {
  const refusal = "I'm not able to help with that request.";
  assert.equal(isInternalEnvelope(refusal, "REFUSAL"), false);
  assert.equal(chatErrorCopy(refusal, "REFUSAL").message, refusal);
});

/* ── 041b — which turns may offer "Try again" ───────────────────────────────── */

test("041b — THE BUG: a turn that ended in an error BLOCK offers a retry", () => {
  // The common failure. The agent reached its model, the model returned 502, the agent caught it
  // and streamed an `error` block on a 200 response. The page had no failed message to offer, so
  // the card said "please try again" with nothing to press.
  assert.equal(
    turnCanRetry({ streaming: false, blockTypes: ["tool_step", "error"] }),
    true,
  );
});

test("041b — a turn whose REQUEST failed still offers a retry", () => {
  assert.equal(turnCanRetry({ streaming: false, error: "Upstream unavailable", blockTypes: [] }), true);
});

test("041b — a turn still streaming offers nothing, even once an error block has arrived", () => {
  // There may yet be an answer, and a retry offered mid-turn invites a second message about a
  // question that is still being answered.
  assert.equal(turnCanRetry({ streaming: true, blockTypes: ["error"] }), false);
  assert.equal(turnCanRetry({ streaming: true, blockTypes: [] }), false);
});

test("041b — a successful turn offers no retry", () => {
  assert.equal(turnCanRetry({ streaming: false, blockTypes: ["tool_step", "text", "citation"] }), false);
});

test("041b — an INERT card alone is not a retryable failure", () => {
  // Inert means a block we could not validate; it renders its own non-actionable notice by
  // design, and the rest of the turn may be a perfectly good answer.
  assert.equal(turnCanRetry({ streaming: false, blockTypes: ["text"] }), false);
  assert.equal(turnCanRetry({ streaming: false, blockTypes: [] }), false);
});
