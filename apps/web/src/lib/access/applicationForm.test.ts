import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_DRAFT,
  MAX_CONTACT,
  MAX_NAME,
  MAX_REASON,
  parseApplication,
  shouldShowForm,
  statusLine,
  toSubmitBody,
  validateDraft,
} from "./applicationForm.ts";

const good = {
  contact: "  me@example.com ",
  name: " Ada ",
  reason: "  I want to test the vault deposit flow on Base Sepolia.  ",
};

test("an empty draft fails on all three fields", () => {
  const v = validateDraft(EMPTY_DRAFT);
  assert.equal(v.valid, false);
  assert.ok(v.errors.contact);
  assert.ok(v.errors.name);
  assert.ok(v.errors.reason);
});

test("a complete draft validates (whitespace-only values do not)", () => {
  assert.equal(validateDraft(good).valid, true);
  const blank = validateDraft({ contact: "   ", name: "\t", reason: "          " });
  assert.equal(blank.valid, false);
  assert.equal(Object.keys(blank.errors).length, 3);
});

test("a one-word reason is refused — a reason is asked for, not a checkbox", () => {
  const v = validateDraft({ ...good, reason: "yes" });
  assert.equal(v.valid, false);
  assert.ok(v.errors.reason);
  assert.equal(v.errors.contact, undefined);
});

test("each field is capped at the server/DB limit", () => {
  assert.equal(validateDraft({ ...good, contact: "a".repeat(MAX_CONTACT) }).valid, true);
  assert.equal(validateDraft({ ...good, contact: "a".repeat(MAX_CONTACT + 1) }).valid, false);
  assert.equal(validateDraft({ ...good, name: "a".repeat(MAX_NAME + 1) }).valid, false);
  assert.equal(validateDraft({ ...good, reason: "a".repeat(MAX_REASON + 1) }).valid, false);
});

test("the submit body is trimmed and carries NO wallet field (the server scopes the owner)", () => {
  const body = toSubmitBody(good);
  assert.deepEqual(body, {
    contact: "me@example.com",
    name: "Ada",
    reason: "I want to test the vault deposit flow on Base Sepolia.",
  });
  assert.deepEqual(Object.keys(body).sort(), ["contact", "name", "reason"]);
});

/* -------------------------------- parsing -------------------------------- */

const wire = {
  application: {
    address: "0xabc",
    contact: "me@example.com",
    name: "Ada",
    reason: "testing",
    status: "pending",
    submittedAt: "2026-08-02T00:00:00+00:00",
    updatedAt: "2026-08-02T00:00:00+00:00",
  },
};

test("parseApplication reads the agent envelope", () => {
  const app = parseApplication(wire);
  assert.ok(app);
  assert.equal(app.status, "pending");
  assert.equal(app.contact, "me@example.com");
});

test("parseApplication returns null for anything it doesn't recognise (never a guess)", () => {
  assert.equal(parseApplication(null), null);
  assert.equal(parseApplication({ application: null }), null);
  assert.equal(parseApplication({}), null);
  assert.equal(parseApplication("nope"), null);
  assert.equal(parseApplication({ application: { status: "weird" } }), null);
});

/* --------------------------------- copy ---------------------------------- */

test("status copy names the real state, and only an approved applicant loses the form", () => {
  assert.equal(statusLine(null), undefined);
  assert.equal(shouldShowForm(null), true);

  const pending = parseApplication(wire)!;
  assert.match(statusLine(pending) ?? "", /pending review/);
  assert.equal(shouldShowForm(pending), true);

  const denied = parseApplication({ application: { ...wire.application, status: "denied" } })!;
  assert.match(statusLine(denied) ?? "", /wasn't approved/);
  assert.equal(shouldShowForm(denied), true, "a denied applicant can re-submit");

  const approved = parseApplication({ application: { ...wire.application, status: "approved" } })!;
  assert.match(statusLine(approved) ?? "", /approved/);
  assert.equal(shouldShowForm(approved), false);
});
