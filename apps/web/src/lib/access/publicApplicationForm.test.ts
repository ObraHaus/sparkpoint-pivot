import assert from "node:assert/strict";
import { test } from "node:test";
import * as signedIn from "./applicationForm.ts";
import {
  EMPTY_PUBLIC_DRAFT,
  MAX_CONTACT,
  MAX_NAME,
  MAX_REASON,
  isWalletAddress,
  looksAutomated,
  submitErrorMessage,
  toPublicSubmitBody,
  validatePublicDraft,
  type PublicApplicationDraft,
} from "./publicApplicationForm.ts";

const ADDR = "0x1111111111111111111111111111111111111111";

const good: PublicApplicationDraft = {
  address: `  ${ADDR} `,
  contact: "  me@example.com ",
  name: " Ada ",
  reason: "  I want to test the vault deposit flow on Base Sepolia.  ",
  website: "",
};

test("the caps match the signed-in form's, which match the agent's and the DB's CHECKs", () => {
  // The public model restates these because the test runner cannot resolve extensionless imports
  // from a module under test (see the file header). This is where the duplication is held honest:
  // if one form's cap is ever raised without the other, the two forms would disagree about what
  // the SERVER will accept, and one of them would be lying to its user.
  assert.equal(MAX_CONTACT, signedIn.MAX_CONTACT);
  assert.equal(MAX_NAME, signedIn.MAX_NAME);
  assert.equal(MAX_REASON, signedIn.MAX_REASON);
});

test("a complete draft is valid and trims on the way out", () => {
  const v = validatePublicDraft(good);
  assert.equal(v.valid, true);
  assert.deepEqual(toPublicSubmitBody(good), {
    address: ADDR,
    contact: "me@example.com",
    name: "Ada",
    reason: "I want to test the vault deposit flow on Base Sepolia.",
  });
});

test("the honeypot is never sent to the server", () => {
  const body = toPublicSubmitBody({ ...good, website: "http://spam.example" });
  assert.equal("website" in body, false);
});

test("an empty draft fails on all four fields", () => {
  const v = validatePublicDraft(EMPTY_PUBLIC_DRAFT);
  assert.equal(v.valid, false);
  assert.ok(v.errors.address);
  assert.ok(v.errors.contact);
  assert.ok(v.errors.name);
  assert.ok(v.errors.reason);
});

// ── the address, which is the field this form adds ────────────────────────────

test("a mixed-case address is accepted — we do not demand a checksummed string", () => {
  // Someone typing or pasting from an explorer must not be rejected over capitalisation; the
  // server lowercases it and the DB has a lower() CHECK.
  const mixed = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
  assert.equal(isWalletAddress(mixed), true);
  assert.equal(validatePublicDraft({ ...good, address: mixed }).valid, true);
});

test("the wrong SHAPE of hex is refused, and the message says what shape is wanted", () => {
  // A 32-byte transaction hash is the most common wrong paste, and it starts with 0x too.
  const txHash = `0x${"a".repeat(64)}`;
  const v = validatePublicDraft({ ...good, address: txHash });
  assert.equal(v.valid, false);
  assert.match(v.errors.address!, /40 characters/);
});

test("a non-hex string gets the 0x hint rather than the length hint", () => {
  const v = validatePublicDraft({ ...good, address: "sparky.eth" });
  assert.equal(v.valid, false);
  assert.match(v.errors.address!, /starts with 0x/);
});

test("hex with a non-hex character inside is refused", () => {
  assert.equal(isWalletAddress(`0x${"z".repeat(40)}`), false);
});

test("the zero and burn addresses are refused — nobody can hold an invite there", () => {
  for (const addr of [
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dEaD",
  ]) {
    assert.equal(isWalletAddress(addr), false, addr);
    assert.equal(validatePublicDraft({ ...good, address: addr }).valid, false, addr);
  }
});

// ── the text fields ───────────────────────────────────────────────────────────

test("each text field is capped at the same length the agent and the DB enforce", () => {
  const over = (key: "contact" | "name" | "reason", cap: number) => {
    const v = validatePublicDraft({ ...good, [key]: "x".repeat(cap + 1) });
    assert.equal(v.valid, false, key);
    assert.match(v.errors[key]!, new RegExp(String(cap)), key);
  };
  over("contact", MAX_CONTACT);
  over("name", MAX_NAME);
  over("reason", MAX_REASON);
});

test("a one-word reason is refused; a sentence is not", () => {
  assert.equal(validatePublicDraft({ ...good, reason: "pls" }).valid, false);
  assert.equal(validatePublicDraft({ ...good, reason: "I would like to try it." }).valid, true);
});

test("a short answer is told it is SHORT, an empty one is told it is missing", () => {
  // "A reason for access is required." is a lie when the field says "pls" — the applicant did
  // answer, and sending them to look for a field they already filled in is the wrong instruction.
  const short = validatePublicDraft({ ...good, reason: "pls" }).errors.reason!;
  const empty = validatePublicDraft({ ...good, reason: "  " }).errors.reason!;
  assert.match(short, /tell us a little more/i);
  assert.doesNotMatch(short, /required/i);
  assert.match(empty, /required/i);
});

test("whitespace-only input counts as missing, not as content", () => {
  const v = validatePublicDraft({ ...good, name: "   \t " });
  assert.equal(v.valid, false);
  assert.ok(v.errors.name);
});

// ── the honeypot + the messages ───────────────────────────────────────────────

test("a filled honeypot is detectable but never makes the draft invalid", () => {
  const trapped = { ...good, website: "http://spam.example" };
  assert.equal(looksAutomated(trapped), true);
  // Crucially still "valid": the bot must be told it succeeded, not shown a validation error it
  // could learn from. The server is what drops the submission.
  assert.equal(validatePublicDraft(trapped).valid, true);
  assert.equal(looksAutomated(good), false);
});

test("the rate-limit message never says which limit was hit", () => {
  const message = submitErrorMessage(429);
  assert.match(message, /try again/i);
  for (const leak of ["IP", "global", "per-hour", "limit of"]) {
    assert.equal(message.includes(leak), false, leak);
  }
});

test("every failure status produces a message that tells the user what to do", () => {
  for (const status of [0, 400, 429, 500, 502, 503]) {
    assert.match(submitErrorMessage(status), /try again|check the details/i, String(status));
  }
});
