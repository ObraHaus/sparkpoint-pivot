// Mint an `sp_session` cookie by doing a REAL SIWE handshake, and print it. Nothing else.
//
//   WEB_URL=https://alpha.sparkpoint.io PW_TEST_PRIVKEY=0x… node apps/web/e2e/print-session.mjs
//
// ⚠️ Why this exists rather than driving the wallet in the browser: the injected-wallet path stalls
// at "Waiting for signature…" against a deployed app, while the handshake itself works fine. So the
// handshake is done here, in Node, and the resulting cookie is handed to Playwright. That is the
// same flow `auth.e2e.mjs` proves server-side; this file is the CLI slice of it, extracted so the
// live-copy-audit workflow can call it. Keeping it separate means the audit does not depend on a
// test file's internals.
//
// Prints ONLY the cookie value on stdout, so the caller can capture it directly. Diagnostics go to
// stderr, and any failure exits non-zero rather than printing an empty string — a blank session
// would let the audit run against a signed-out app and "pass" on a sign-in page.
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const WEB = (process.env.WEB_URL || process.env.PW_BASE_URL || "").replace(/\/+$/, "");
const PK = process.env.PW_TEST_PRIVKEY || process.env.BETA_TEST_PK || "";
const CHAIN = Number(process.env.WEB_CHAIN_ID || 84532);

function die(msg) {
  console.error(`print-session: ${msg}`);
  process.exit(1);
}

if (!WEB) die("set WEB_URL (or PW_BASE_URL)");
if (!PK) die("set PW_TEST_PRIVKEY to an allowlisted ephemeral key");

const jar = {};
function jarFrom(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (v === "") delete jar[k];
    else jar[k] = v;
  }
}
const cookie = () =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

const account = privateKeyToAccount(PK);

const nr = await fetch(`${WEB}/api/auth/nonce`);
if (!nr.ok) die(`nonce failed: ${nr.status}`);
jarFrom(nr);
const { nonce } = await nr.json();

const now = new Date();
const message = createSiweMessage({
  domain: new URL(WEB).host,
  address: account.address,
  statement: "copy audit",
  uri: WEB,
  version: "1",
  chainId: CHAIN,
  nonce,
  issuedAt: now,
  expirationTime: new Date(now.getTime() + 6e5),
});

const vr = await fetch(`${WEB}/api/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: cookie() },
  body: JSON.stringify({ message, signature: await account.signMessage({ message }) }),
});
jarFrom(vr);
if (!vr.ok) die(`verify failed: ${vr.status} ${await vr.text().catch(() => "")}`);

const session = jar["sp_session"];
if (!session) die("verify succeeded but set no sp_session cookie");

console.error(`print-session: signed in as ${account.address}`);
process.stdout.write(session);
