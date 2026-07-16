// Phase B / B.1 auth e2e — runs against a DEPLOYED web app with ephemeral, self-signed wallets.
//
//   WEB_URL=https://<slug>.aldrickb.app node --test apps/web/e2e/auth.e2e.mjs
//
// Self-contained: generates fresh keys (viem), performs the real SIWE handshake, and asserts the
// server-enforced auth behaviors. Skips (does not fail) when WEB_URL is unset, so it never breaks
// an offline CI run. Lives in apps/web so the bare `viem` imports resolve. (Phase D expands this
// into the full gate/deposit/exit matrix.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const WEB = (process.env.WEB_URL || "").replace(/\/+$/, "");
const CHAIN = Number(process.env.WEB_CHAIN_ID || 84532);
const skip = WEB ? false : "set WEB_URL to run the live auth e2e";

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

/** Full SIWE handshake. `domain`/`withExpiration` overridable to exercise the negative paths. */
async function login(account, { domain = new URL(WEB).host, withExpiration = true } = {}) {
  const jar = {};
  const nr = await fetch(`${WEB}/api/auth/nonce`);
  jarFrom(nr, jar);
  const { nonce } = await nr.json();
  const now = new Date();
  const message = createSiweMessage({
    domain,
    address: account.address,
    statement: "auth e2e",
    uri: WEB,
    version: "1",
    chainId: CHAIN,
    nonce,
    issuedAt: now,
    ...(withExpiration ? { expirationTime: new Date(now.getTime() + 10 * 60 * 1000) } : {}),
  });
  const signature = await account.signMessage({ message });
  const vr = await fetch(`${WEB}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookie(jar) },
    body: JSON.stringify({ message, signature }),
  });
  jarFrom(vr, jar);
  return { jar, status: vr.status, body: await vr.json().catch(() => ({})) };
}

test("non-beta session is blocked from the assistant API (403)", { skip }, async () => {
  const account = privateKeyToAccount(generatePrivateKey()); // fresh ⇒ not allowlisted
  const { status, body, jar } = await login(account);
  assert.equal(status, 200, "SIWE handshake itself succeeds");
  assert.equal(body.beta, false, "a fresh wallet is not in the beta");

  const chat = await fetch(`${WEB}/api/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-chain-id": String(CHAIN), cookie: cookie(jar) },
    body: JSON.stringify({ message: "hello" }),
  });
  assert.equal(chat.status, 403, "non-beta wallet cannot drive the assistant");
  const err = await chat.json().catch(() => ({}));
  assert.equal(err?.error?.code, "BETA_NOT_ENABLED", "honest beta-required error");
});

test("SIWE message with a mismatched domain is rejected", { skip }, async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const { status, body } = await login(account, { domain: "evil.phisher.example" });
  assert.equal(status, 400, "verify rejects a foreign-domain message");
  assert.equal(body.error, "bad_domain");
});

test("SIWE message without an expiration is rejected", { skip }, async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const { status, body } = await login(account, { withExpiration: false });
  assert.equal(status, 400);
  assert.equal(body.error, "expiration_required");
});
