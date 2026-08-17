import assert from "node:assert/strict";
import { test } from "node:test";
import { SlidingWindowLimiter, clientIp } from "./rateLimit.ts";

const HOUR = 60 * 60 * 1000;
const RULE = { limit: 3, windowMs: HOUR };

test("the first `limit` attempts pass and the next does not", () => {
  const l = new SlidingWindowLimiter(RULE);
  for (let i = 0; i < 3; i++) assert.equal(l.check("a", 1_000).allowed, true, `attempt ${i}`);
  assert.equal(l.check("a", 1_000).allowed, false);
});

test("keys are independent — one caller's limit is not everyone's", () => {
  const l = new SlidingWindowLimiter(RULE);
  for (let i = 0; i < 3; i++) l.check("a", 1_000);
  assert.equal(l.check("a", 1_000).allowed, false);
  assert.equal(l.check("b", 1_000).allowed, true);
});

test("the window SLIDES — attempts older than the window stop counting", () => {
  const l = new SlidingWindowLimiter(RULE);
  for (let i = 0; i < 3; i++) l.check("a", 1_000);
  assert.equal(l.check("a", 1_000 + HOUR - 1).allowed, false, "still inside the window");
  assert.equal(l.check("a", 1_000 + HOUR + 1).allowed, true, "the window has passed");
});

test("a rejected attempt is not recorded, so being over the limit is never a permanent ban", () => {
  // If a rejection pushed its own timestamp into the window, a caller hammering the endpoint would
  // keep extending their own block and could never recover — a throttle silently becoming a ban.
  const l = new SlidingWindowLimiter(RULE);
  for (let i = 0; i < 3; i++) l.check("a", 0);
  for (let t = 1; t < 1000; t++) l.check("a", t); // hammering, all rejected
  assert.equal(l.check("a", HOUR + 1).allowed, true);
});

test("retryAfter counts down as the oldest attempt ages out, and is never zero when blocked", () => {
  const l = new SlidingWindowLimiter(RULE);
  for (let i = 0; i < 3; i++) l.check("a", 0);
  const early = l.check("a", 0);
  const late = l.check("a", HOUR - 5_000);
  assert.equal(early.allowed, false);
  assert.equal(early.retryAfterSeconds, 3600);
  assert.equal(late.retryAfterSeconds, 5);
  // A `Retry-After: 0` invites an immediate retry that would also be rejected.
  assert.ok(l.check("a", HOUR - 1).retryAfterSeconds >= 1);
});

test("the key space is bounded — a spoofed-IP flood cannot grow the map without limit", () => {
  const l = new SlidingWindowLimiter(RULE, 8);
  for (let i = 0; i < 500; i++) l.check(`ip-${i}`, 1_000);
  assert.ok(l.size <= 8, `map grew to ${l.size}`);
});

test("expired keys are evicted before live ones when the map is full", () => {
  const l = new SlidingWindowLimiter(RULE, 4);
  for (let i = 0; i < 4; i++) l.check(`old-${i}`, 0);
  // Well past the window: every existing key is dead and should be reclaimed, leaving the newcomer
  // with a full allowance rather than an eviction-scarred one.
  const now = HOUR * 2;
  for (let i = 0; i < 3; i++) {
    assert.equal(l.check("fresh", now).allowed, true, `fresh attempt ${i}`);
  }
  assert.equal(l.check("fresh", now).allowed, false);
});

// ── client IP extraction, behind three proxies ────────────────────────────────

test("the client IP is the FIRST x-forwarded-for entry, not the nearest proxy", () => {
  const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" });
  assert.deepEqual(clientIp(h), { key: "203.0.113.7", source: "forwarded" });
});

test("cf-connecting-ip WINS over x-forwarded-for — Cloudflare overwrites it, a client cannot", () => {
  // In an appending chain the leftmost x-forwarded-for entry is whatever the CALLER sent. Where
  // Cloudflare is in front, its own header is the one that cannot be forged, so it must be
  // preferred even when a forwarded chain is also present.
  const h = new Headers({
    "cf-connecting-ip": "203.0.113.7",
    "x-forwarded-for": "1.2.3.4, 203.0.113.7, 10.0.0.1",
  });
  assert.deepEqual(clientIp(h), { key: "203.0.113.7", source: "cf" });
});

test("x-real-ip is used only as a last resort, and is labelled as the weak signal it is", () => {
  // Behind several hops this names the PREVIOUS proxy far more often than the client, so it is
  // ranked below x-forwarded-for and tagged so the caller can weigh it.
  assert.deepEqual(clientIp(new Headers({ "x-real-ip": " 198.51.100.4 " })), {
    key: "198.51.100.4",
    source: "real-ip",
  });
});

test("no proxy header at all reports source 'none' — the signal the caller MUST check", () => {
  // This is the dangerous deployment: every visitor shares one bucket. The route skips the
  // per-visitor limit entirely when it sees this, because a 3/hour limit on a bucket shared by
  // everyone refuses the fourth applicant on the internet and tells them they applied too often.
  assert.deepEqual(clientIp(new Headers()), { key: "unknown", source: "none" });
});

test("an empty forwarded header falls through instead of producing an empty key", () => {
  assert.deepEqual(clientIp(new Headers({ "x-forwarded-for": "  ", "x-real-ip": "198.51.100.4" })), {
    key: "198.51.100.4",
    source: "real-ip",
  });
  assert.deepEqual(clientIp(new Headers({ "x-forwarded-for": "  " })), {
    key: "unknown",
    source: "none",
  });
});

test("a whitespace-only cf header does not shadow a usable forwarded chain", () => {
  const h = new Headers({ "cf-connecting-ip": "   ", "x-forwarded-for": "203.0.113.7" });
  assert.deepEqual(clientIp(h), { key: "203.0.113.7", source: "forwarded" });
});
