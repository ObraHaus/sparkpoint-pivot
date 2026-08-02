import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMandateSaveError,
  mandateSaveHint,
  type MandateSaveFailure,
} from "./mandateSave.ts";

/** A structural stand-in for `AgentApiError` (the real class lives in the non-leaf client.ts). */
function agentError(code: string, message: string, httpStatus = 400): unknown {
  return Object.assign(new Error(message), { code, httpStatus, reasons: [], retryable: false });
}

/* ── classify ──────────────────────────────────────────────────────────────── */

test("a §1.5 envelope classifies as a SERVER rejection, carrying its code + message", () => {
  const f = classifyMandateSaveError(
    agentError("VALIDATION_ERROR", "Idempotency-Key must be a UUID (§1.3)."),
  );
  assert.equal(f.kind, "server");
  assert.equal(f.code, "VALIDATION_ERROR");
  assert.equal(f.message, "Idempotency-Key must be a UUID (§1.3).");
});

test("a server envelope is recognized structurally, not by instanceof", () => {
  // The error may cross a bundle/realm boundary where `instanceof AgentApiError` is false.
  const plain = { code: "POLICY_REJECTED", httpStatus: 422, message: "Out of policy." };
  assert.equal(classifyMandateSaveError(plain).kind, "server");
  assert.equal(classifyMandateSaveError(plain).code, "POLICY_REJECTED");
});

test("an upstream-unavailable envelope stays SERVER — it has a real message worth quoting", () => {
  const f = classifyMandateSaveError(
    agentError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now.", 502),
  );
  assert.equal(f.kind, "server");
  assert.equal(f.message, "The assistant is unavailable right now.");
});

test("a fetch transport failure classifies as NETWORK", () => {
  assert.equal(classifyMandateSaveError(new TypeError("Failed to fetch")).kind, "network");
});

test("an aborted request classifies as NETWORK", () => {
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert.equal(classifyMandateSaveError(abort).kind, "network");
});

test("anything else classifies as UNEXPECTED, never silently as a connection problem", () => {
  const f = classifyMandateSaveError(new Error("client refuses to send a signature"));
  assert.equal(f.kind, "unexpected");
  assert.equal(f.message, "client refuses to send a signature");
  assert.equal(classifyMandateSaveError(undefined).kind, "unexpected");
  assert.equal(classifyMandateSaveError("boom").kind, "unexpected");
});

test("a partial error shape is NOT mistaken for a server envelope", () => {
  // Only `code`, no httpStatus ⇒ not a §1.5 envelope; must not claim a server rejection.
  assert.notEqual(classifyMandateSaveError({ code: "NOPE" }).kind, "server");
});

/* ── copy ──────────────────────────────────────────────────────────────────── */

test("no failure ⇒ the neutral resting hint", () => {
  assert.equal(mandateSaveHint(null), "You can change this anytime in Settings.");
  assert.equal(mandateSaveHint(undefined), "You can change this anytime in Settings.");
});

test("ONLY a real transport failure mentions the connection", () => {
  const mentionsConnection = (h: string) => /connection/i.test(h);

  assert.ok(mentionsConnection(mandateSaveHint({ kind: "network" })));

  // The regression this whole change exists for: a hard 400 used to read "check your connection".
  const server = mandateSaveHint({
    kind: "server",
    code: "VALIDATION_ERROR",
    message: "Idempotency-Key must be a UUID (§1.3).",
  });
  assert.equal(mentionsConnection(server), false);
  assert.ok(server.includes("Idempotency-Key must be a UUID (§1.3)."));
  assert.ok(server.includes("VALIDATION_ERROR"));

  assert.equal(mentionsConnection(mandateSaveHint({ kind: "offline" })), false);
  assert.equal(mentionsConnection(mandateSaveHint({ kind: "unexpected" })), false);
});

test("a server rejection with no message still names the code", () => {
  const h = mandateSaveHint({ kind: "server", code: "INTERNAL" });
  assert.ok(h.includes("INTERNAL"));
  assert.ok(h.startsWith("Couldn’t save your plan"));
});

test("a server rejection with neither message nor code still reads honestly", () => {
  const h = mandateSaveHint({ kind: "server" });
  assert.ok(h.includes("the server rejected it"));
  assert.equal(h.includes("undefined"), false);
});

test("offline points at the wallet, not the network", () => {
  assert.ok(/wallet/i.test(mandateSaveHint({ kind: "offline" })));
});

test("a runaway server message is clamped so the one-line dock hint can't blow out", () => {
  const h = mandateSaveHint({ kind: "server", code: "INTERNAL", message: "x".repeat(500) });
  assert.ok(h.length < 220, `hint was ${h.length} chars`);
  assert.ok(h.endsWith("(INTERNAL)"));
});

test("every failure kind produces non-empty copy (exhaustive)", () => {
  const kinds: MandateSaveFailure["kind"][] = ["offline", "server", "network", "unexpected"];
  for (const kind of kinds) {
    const h = mandateSaveHint({ kind });
    assert.ok(h.length > 0, `${kind} produced no copy`);
    assert.equal(h.includes("undefined"), false, `${kind} leaked "undefined"`);
  }
});
