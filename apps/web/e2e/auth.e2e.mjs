// Phase B/B.1/D full-stack auth + gate e2e — runs against a DEPLOYED web app with ephemeral,
// self-signed wallets. Self-contained (generates keys, does the real SIWE handshake, drives the
// live BFF + middleware). Skips (never fails) when WEB_URL is unset.
//
//   WEB_URL=https://<slug>.aldrickb.app node --test apps/web/e2e/auth.e2e.mjs
//
// Optional beta path: set BETA_TEST_PK to an ephemeral private key that YOU have added to
// BETA_ALLOWLIST (agent) — then the beta-allowed scenarios run too. Lives in apps/web so `viem`
// resolves. Browser-level flows (real chat render, deposit quote→sim→sign UI, /exit with the agent
// container stopped) are the remaining Playwright follow-up; this proves the server-enforced gates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const WEB = (process.env.WEB_URL || "").replace(/\/+$/, "");
const CHAIN = Number(process.env.WEB_CHAIN_ID || 84532);
const skip = WEB ? false : "set WEB_URL to run the live auth e2e";
// 2026-10-04 — `BETA_OPEN=true` deployments admit EVERY signed-in wallet (the public beta). Set
// BETA_OPEN_EXPECTED=true when running against one: the closed-beta denial assertions are skipped
// and the open-beta admission assertions run instead. Default is the closed beta (unchanged).
const BETA_OPEN = (process.env.BETA_OPEN_EXPECTED ?? "").toLowerCase() === "true";
const closedSkip = skip || (BETA_OPEN ? "the deployment runs BETA_OPEN=true (public beta)" : false);

function jarFrom(res, jar) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (v === "") delete jar[k];
    else jar[k] = v;
  }
}
const cookie = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
const hit = (path, jar) =>
  fetch(`${WEB}${path}`, { redirect: "manual", headers: jar ? { cookie: cookie(jar) } : {} });

async function login(account, { domain = new URL(WEB).host, withExpiration = true } = {}) {
  const jar = {};
  const nr = await fetch(`${WEB}/api/auth/nonce`);
  jarFrom(nr, jar);
  const { nonce } = await nr.json();
  const now = new Date();
  const message = createSiweMessage({
    domain, address: account.address, statement: "auth e2e", uri: WEB, version: "1",
    chainId: CHAIN, nonce, issuedAt: now,
    ...(withExpiration ? { expirationTime: new Date(now.getTime() + 6e5) } : {}),
  });
  const signature = await account.signMessage({ message });
  const vr = await fetch(`${WEB}/api/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookie(jar) },
    body: JSON.stringify({ message, signature }),
  });
  jarFrom(vr, jar);
  return { jar, status: vr.status, body: await vr.json().catch(() => ({})) };
}
const chat = (jar) =>
  fetch(`${WEB}/api/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-chain-id": String(CHAIN), cookie: cookie(jar) },
    body: JSON.stringify({ message: "hello" }),
  });
// 026 — the ONE agent path a signed-in but NON-beta wallet may reach: its own access application.
const application = (jar, body) =>
  fetch(`${WEB}/api/agent/access/application`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-chain-id": String(CHAIN), cookie: cookie(jar) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

// ── Unauthenticated gate matrix ──────────────────────────────────────────────
test("unauthenticated gate matrix", { skip }, async () => {
  const gated = ["/chat", "/vault", "/settings", "/portfolio", "/onboarding"];
  for (const p of gated) {
    const r = await hit(p);
    assert.equal(r.status, 307, `${p} redirects when unauthenticated`);
    assert.equal(new URL(r.headers.get("location"), WEB).pathname, "/connect", `${p} → /connect`);
  }
  assert.equal((await hit("/admin")).status, 404, "/admin invisible to non-admins (404)");
  // Never gated — landing, login flow, escape hatches.
  for (const p of ["/", "/connect", "/verify", "/exit", "/trust", "/trust/permissions", "/trust/exit"]) {
    assert.equal((await hit(p)).status, 200, `${p} is public`);
  }
});

// ── Non-beta wallet: authenticates but is denied (closed beta only) ──────────
test("non-beta wallet: SIWE ok, but denied from app + assistant", { skip: closedSkip }, async () => {
  const { status, body, jar } = await login(privateKeyToAccount(generatePrivateKey()));
  assert.equal(status, 200);
  assert.equal(body.beta, false);
  assert.equal(body.admin, false);
  // page: → /verify (honest not-in-beta); admin: 404; API: 403.
  const c = await hit("/chat", jar);
  assert.equal(c.status, 307);
  assert.equal(new URL(c.headers.get("location"), WEB).pathname, "/verify");
  assert.equal((await hit("/admin", jar)).status, 404);
  const api = await chat(jar);
  assert.equal(api.status, 403);
  assert.equal((await api.json()).error?.code, "BETA_NOT_ENABLED");
});

// ── 026: a non-beta wallet is no longer a dead end — it may apply, and ONLY apply ────────────
test("non-beta wallet may reach the access-application endpoint (and nothing else)", { skip: closedSkip }, async () => {
  const { jar, body } = await login(privateKeyToAccount(generatePrivateKey()));
  assert.equal(body.beta, false, "a fresh random wallet must not be allowlisted");

  // The narrow BFF exemption: this path is NOT 403 BETA_NOT_ENABLED for a non-beta session.
  const own = await application(jar);
  assert.notEqual(own.status, 403, "/access/application must be reachable without beta");
  if (own.status === 200) assert.equal((await own.json()).application, null, "no application yet");

  // Everything else still is. (Deliberate: the exemption is one path prefix, not a hole.)
  assert.equal((await chat(jar)).status, 403, "the assistant stays gated");
  const admin = await fetch(`${WEB}/api/agent/admin/access/applications`, {
    headers: { "x-chain-id": String(CHAIN), cookie: cookie(jar) },
  });
  assert.equal(admin.status, 403, "the admin review surface is NOT part of the exemption");
});

// ── Open beta: a fresh wallet is admitted, admin still is not (BETA_OPEN_EXPECTED=true) ──────
test("open beta: a fresh wallet reaches the app but not admin", { skip: skip || !BETA_OPEN }, async () => {
  const { status, body, jar } = await login(privateKeyToAccount(generatePrivateKey()));
  assert.equal(status, 200);
  assert.equal(body.beta, true, "an open beta must admit a freshly generated wallet");
  assert.equal(body.admin, false, "opening the beta must never grant admin");
  assert.equal((await hit("/chat", jar)).status, 200, "an admitted wallet reaches /chat");
  assert.equal((await hit("/admin", jar)).status, 404, "beta ≠ admin → /admin 404");
  assert.notEqual((await chat(jar)).status, 403, "the assistant is no longer 403 for a fresh wallet");
});

// ── SIWE negative paths ──────────────────────────────────────────────────────
test("SIWE rejects a mismatched domain", { skip }, async () => {
  const { status, body } = await login(privateKeyToAccount(generatePrivateKey()), { domain: "evil.phisher.example" });
  assert.equal(status, 400);
  assert.equal(body.error, "bad_domain");
});
test("SIWE rejects a message without an expiration", { skip }, async () => {
  const { status, body } = await login(privateKeyToAccount(generatePrivateKey()), { withExpiration: false });
  assert.equal(status, 400);
  assert.equal(body.error, "expiration_required");
});

// ── Optional: a beta-allowlisted wallet reaches the app (set BETA_TEST_PK) ────
const betaSkip = skip || (process.env.BETA_TEST_PK ? false : "set BETA_TEST_PK (an allowlisted key) to run");
test("beta wallet reaches the app but not admin", { skip: betaSkip }, async () => {
  const { status, body, jar } = await login(privateKeyToAccount(process.env.BETA_TEST_PK));
  assert.equal(status, 200);
  assert.equal(body.beta, true, "the test wallet must be in BETA_ALLOWLIST");
  assert.equal((await hit("/chat", jar)).status, 200, "beta wallet reaches /chat");
  assert.equal((await hit("/admin", jar)).status, 404, "beta ≠ admin → /admin 404");
});
