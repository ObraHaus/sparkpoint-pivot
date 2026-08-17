/**
 * `POST /api/access/apply` — the PUBLIC alpha application (045). No session, no wallet, no
 * signature: the applicant types their address on the landing page.
 *
 * WHY IT IS NOT `/api/agent/access/application`. That path is the BFF catch-all, and the catch-all
 * requires a verified SIWE session before it forwards anything — by design, since it is the tier
 * that asserts identity to the agent. This route is its deliberate opposite: it forwards ONE fixed
 * agent path, asserts no identity at all, and carries the s2s bearer so the agent still knows the
 * call came from the web tier and not from the internet.
 *
 * Everything a public write needs, in one place:
 *   - the shape is validated here AND re-validated by the agent (this is a courtesy, not the gate);
 *   - a per-IP and a global rate limit, because the SIWE session used to be the throttle;
 *   - a honeypot field that is silently accepted and dropped — a bot told it failed learns how to
 *     pass next time;
 *   - ONE response for every outcome, so nobody can probe who has applied or who has access.
 *
 * ⚠️ Gate note: this path is in `ALLOW_EXACT` in `apps/web/middleware.ts`. Gate 2 (`/api` prefix)
 * would pass it on develop anyway, but a LOCKED deploy serves the landing page — and therefore this
 * form — while 307ing every `/api` path that is not listed by exact match. Public in one deploy
 * shape and not the other is the bug `src/lib/copy/publicPaths.test.ts` was written about.
 */

import { NextResponse } from "next/server";
import { MAX_CONTACT, MAX_NAME, MAX_REASON } from "@/lib/access/publicApplicationForm";
import { SlidingWindowLimiter, clientIp } from "@/lib/access/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_INTERNAL_URL = process.env.AGENT_INTERNAL_URL;
const AGENT_S2S_TOKEN = process.env.AGENT_S2S_TOKEN;

/**
 * Both limits are env-tunable, and that is an OPERATIONAL requirement rather than a nicety.
 *
 * Whether a per-visitor limit is even meaningful here depends on a header surviving three proxies
 * (see `clientIp`), which is a property of the deployment and not of this code. If the measurement
 * described in the 045 spec ever comes back saying the signal is useless, the fix must not require
 * a code change and a rebuild: set `ACCESS_APPLY_PER_IP_LIMIT=0` and redeploy, and the per-visitor
 * limit is off while the global ceiling still stands.
 */
function limitFrom(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw >= 0 ? raw : fallback;
}

/**
 * Whether to believe `cf-connecting-ip`. Default OFF, and it must stay that way anywhere Cloudflare
 * is not genuinely in front — see `clientIp`. Measured against live alpha: that deployment answers
 * from openresty with no `cf-ray`, and a `cf-connecting-ip` supplied by the caller reached the app
 * intact and was given its own rate-limit bucket. Trusting it there would have handed an attacker
 * the top-priority key. Set `ACCESS_APPLY_TRUST_CF_HEADER=true` only on a domain that terminates at
 * Cloudflare, which overwrites the header and thereby makes it evidence.
 */
const TRUST_CF = process.env.ACCESS_APPLY_TRUST_CF_HEADER === "true";

/** Applying is a once-in-a-lifetime act for a real person; 3/hour is generous for a typo-fixer. */
const PER_IP_LIMIT = limitFrom("ACCESS_APPLY_PER_IP_LIMIT", 3);
const PER_IP = new SlidingWindowLimiter({ limit: PER_IP_LIMIT, windowMs: 60 * 60 * 1000 });
/** A second ceiling for the case the per-IP one cannot see: many IPs, one script. */
const GLOBAL = new SlidingWindowLimiter(
  { limit: limitFrom("ACCESS_APPLY_GLOBAL_LIMIT", 120), windowMs: 60 * 60 * 1000 },
  4,
);

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** The single success body. Identical for a new application, a duplicate, and an existing one. */
const RECEIVED = { ok: true } as const;

function bad(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { message } }, { status: 400 });
}

function field(
  value: unknown,
  cap: number,
  label: string,
  min = 1,
  tooShort?: string,
): string | NextResponse {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0) return bad(`${label} is required.`);
  // A short-but-present answer is not a missing one; saying "required" sends them looking for a
  // field they already filled in. Mirrors `publicApplicationForm.validatePublicDraft`.
  if (text.length < min) return bad(tooShort ?? `${label} is required.`);
  if (text.length > cap) return bad(`${label} must be ${cap} characters or fewer.`);
  return text;
}

export async function POST(req: Request): Promise<NextResponse> {
  const now = Date.now();

  // Rate limits BEFORE parsing: a rejected caller should cost us as little as possible, and the
  // body is the only attacker-controlled thing here that is not fixed-size.
  //
  // The per-visitor limit is SKIPPED when no proxy gave us anything to tell visitors apart: every
  // request would share one bucket, and a 3/hour limit on it refuses the fourth applicant on the
  // whole internet while telling them they applied too often. A form protected only by its global
  // ceiling is a much better outcome than a form that quietly stops accepting anybody.
  //
  // ⚠️ That guard does NOT cover the deployment risk — see `clientIp`. Under `next start` the
  // runtime supplies `x-forwarded-for` itself, so `source: "none"` never fires, and a proxy chain
  // that loses the visitor's address hands us a constant value that looks perfectly healthy from
  // here. Whether this limit is meaningful on alpha is a MEASURED fact (045 spec), and
  // `ACCESS_APPLY_PER_IP_LIMIT=0` turns it off without a code change if the measurement says so.
  const ip = clientIp(req.headers, { trustCloudflare: TRUST_CF });
  if (ip.source !== "none" && PER_IP_LIMIT > 0) {
    const perIp = PER_IP.check(ip.key, now);
    if (!perIp.allowed) {
      return NextResponse.json(
        { ok: false, error: { message: "Too many applications from this connection." } },
        { status: 429, headers: { "retry-after": String(perIp.retryAfterSeconds) } },
      );
    }
  }
  const global = GLOBAL.check("all", now);
  if (!global.allowed) {
    return NextResponse.json(
      { ok: false, error: { message: "We're getting a lot of applications right now." } },
      { status: 429, headers: { "retry-after": String(global.retryAfterSeconds) } },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return bad("Please check the details and try again.");
  }
  if (!raw || typeof raw !== "object") return bad("Please check the details and try again.");
  const body = raw as Record<string, unknown>;

  // The honeypot: accepted, dropped, and reported as success. Telling a bot it was detected is
  // free tuition. A real person never sees this field, so a false positive costs a submission we
  // would otherwise have taken — which is why the field is `website`, not something a password
  // manager or an autofill heuristic would ever populate.
  if (typeof body.website === "string" && body.website.trim().length > 0) {
    return NextResponse.json(RECEIVED);
  }

  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!ADDRESS_RE.test(address)) {
    return bad("That doesn't look like a wallet address — it should be 0x followed by 40 characters.");
  }

  const contact = field(body.contact, MAX_CONTACT, "A contact handle");
  if (contact instanceof NextResponse) return contact;
  const name = field(body.name, MAX_NAME, "A name or alias");
  if (name instanceof NextResponse) return name;
  const reason = field(
    body.reason,
    MAX_REASON,
    "A reason for access",
    10,
    "Please tell us a little more — a sentence or two is plenty.",
  );
  if (reason instanceof NextResponse) return reason;

  if (!AGENT_INTERNAL_URL || !AGENT_S2S_TOKEN) {
    // Not wired to this deployment. Say so honestly rather than pretending we stored it — a form
    // that silently swallows applications is worse than one that is visibly down.
    return NextResponse.json(
      { ok: false, error: { message: "Applications are temporarily unavailable. Please try again later." } },
      { status: 503 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const upstream = await fetch(
      `${AGENT_INTERNAL_URL.replace(/\/+$/, "")}/access/public-application`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${AGENT_S2S_TOKEN}`,
        },
        body: JSON.stringify({ address, contact, name, reason }),
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      },
    );
    if (!upstream.ok) {
      // The agent's own validation is the authority; relay a 400 as a 400 so a caller who sent
      // something we happened not to catch still gets a fixable answer. Everything else is ours.
      const status = upstream.status === 400 ? 400 : 502;
      return NextResponse.json(
        {
          ok: false,
          error: {
            message:
              status === 400
                ? "Please check the details and try again."
                : "Couldn't submit your application right now. Please try again in a moment.",
          },
        },
        { status },
      );
    }
    return NextResponse.json(RECEIVED);
  } catch {
    return NextResponse.json(
      { ok: false, error: { message: "Couldn't submit your application right now. Please try again in a moment." } },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
