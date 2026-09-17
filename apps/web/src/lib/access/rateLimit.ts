/**
 * A small fixed-memory sliding-window limiter for the PUBLIC application endpoint (045).
 *
 * WHY THIS EXISTS AT ALL. Every other write surface in this app is behind a SIWE session, and that
 * session *was* the throttle — you cannot spam a form you must sign a message to reach. The public
 * application form removes it. Without a limiter, one script could fill `access_applications` with
 * junk until the admin review queue is unusable, which is a denial of the review process rather
 * than of the service, and much cheaper to do.
 *
 * WHAT IT IS NOT. This is best-effort, in-process, and resets on redeploy. It is not a security
 * boundary — the boundaries are elsewhere and do not depend on it: the endpoint grants nothing, it
 * cannot modify an existing application, and every field is length-capped in the DB. It exists to
 * keep a bored person with curl from being interesting, and to make a sustained attempt visible.
 *
 * The web app runs as a SINGLE container (see COOLIFY.md), so one process sees every request and
 * in-memory counting is accurate today. If it is ever scaled out, each replica would enforce the
 * limit independently and the effective ceiling multiplies by the replica count — still bounded,
 * just looser. That trade is deliberate: a shared counter would put the DB (or Redis, which this
 * project does not run) on the path of an endpoint whose whole job is to be cheap.
 */

export interface RateLimitRule {
  /** How many events are allowed inside the window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** Seconds until the oldest event in the window expires — the `Retry-After` value. */
  readonly retryAfterSeconds: number;
}

/**
 * Sliding-window counter over a bounded key space.
 *
 * Bounded matters: the key is caller-controlled (an IP), so an unbounded map is itself the
 * amplification — a few million spoofed `X-Forwarded-For` values would cost more memory than the
 * requests cost to send. `maxKeys` caps it, and a full map prunes expired entries first, only
 * evicting live ones if it is genuinely saturated.
 */
export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #rule: RateLimitRule;
  readonly #maxKeys: number;

  constructor(rule: RateLimitRule, maxKeys = 10_000) {
    this.#rule = rule;
    this.#maxKeys = maxKeys;
  }

  /**
   * Record an attempt and say whether it is allowed.
   *
   * `now` is a parameter, not a `Date.now()` call, so the behaviour is testable without sleeping.
   * A REJECTED attempt is not recorded — otherwise a caller already over the limit would keep
   * pushing their own window forward and could never recover, which turns a throttle into a ban.
   */
  check(key: string, now: number): RateLimitVerdict {
    const { limit, windowMs } = this.#rule;
    const cutoff = now - windowMs;
    const recent = (this.#hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= limit) {
      const oldest = recent[0] ?? now;
      this.#hits.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }

    recent.push(now);
    if (!this.#hits.has(key) && this.#hits.size >= this.#maxKeys) this.#evict(cutoff);
    this.#hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Test/introspection aid: how many keys are currently tracked. */
  get size(): number {
    return this.#hits.size;
  }

  /** Drop every key whose events have all expired; if that frees nothing, drop the oldest key. */
  #evict(cutoff: number): void {
    for (const [key, times] of this.#hits) {
      if (times.length === 0 || times[times.length - 1]! <= cutoff) this.#hits.delete(key);
    }
    if (this.#hits.size >= this.#maxKeys) {
      const oldest = this.#hits.keys().next();
      if (!oldest.done) this.#hits.delete(oldest.value);
    }
  }
}

/**
 * The client IP, as far as we can honestly tell — and, just as importantly, whether we could tell
 * at all.
 *
 * ⚠️ THIS RUNS BEHIND THREE HOPS. alpha.sparkpoint.io is served
 * `client → openresty (DigitalOcean) → tailscale → Coolify proxy → this container`, so the socket
 * address this process sees is never the visitor's. Everything depends on a header surviving that
 * chain, and each hop decides for itself whether to append, overwrite, or drop it. There is no way
 * to settle that from the source — it is a property of the deployment, so it is MEASURED against
 * the deployment (see `specs/045-public-access-application/spec.md`).
 *
 * Order of preference, and why each:
 *
 *   1. `cf-connecting-ip` — **only when `trustCloudflare` is set**. Cloudflare overwrites this
 *      header, so where Cloudflare really is in front a client cannot forge it, and it is then the
 *      best signal available. ⚠️ Where Cloudflare is NOT in front it is the worst: nothing
 *      overwrites it, so an attacker sets a fresh value per request and walks straight past the
 *      per-visitor limit using the highest-priority key. **Measured against the live alpha
 *      deployment: a `cf-connecting-ip` this process never should have trusted arrived intact and
 *      got its own bucket.** alpha answers from openresty with no `cf-ray`, so the flag is off
 *      there; the prod client domain terminates TLS at Cloudflare, so it belongs on there.
 *   2. `x-forwarded-for`, leftmost entry — the conventional "closest to the client" choice, and the
 *      correct one for an honest visitor in an appending chain. Measured on alpha: the chain DOES
 *      append (a supplied header arrives at position 0 and gets its own bucket, and a header-less
 *      request gets a different one), which confirms an ordinary browser is keyed on its real
 *      address. It is spoofable in exactly the same breath — but unlike the header above, there is
 *      no better alternative, and the global ceiling is what bounds a determined caller. This
 *      bounds the casual one.
 *   3. `x-real-ip` — usually the PREVIOUS hop rather than the client, so it is a poor signal. Used
 *      only when there is no `x-forwarded-for` at all, where the alternative is no signal.
 *
 * `source: "none"` means no hop passed anything: every visitor lands in one bucket, so a per-visitor
 * limit applied to it would refuse the fourth applicant on the internet while telling them they had
 * applied too often. The caller skips the per-request limit in that case and lets the global ceiling
 * do the work — a looser limit is a far better failure than a closed door.
 *
 * ⚠️ BUT DO NOT MISTAKE THAT GUARD FOR COVERAGE OF THE REAL RISK. Measured against `next start`:
 * **Next.js injects `x-forwarded-for` itself** from the socket peer when the header is absent, so
 * under this runtime `source` is essentially always `"forwarded"` and `"none"` never fires. The
 * guard is kept because it is correct and costs nothing (and a future non-Next runtime would need
 * it), not because it is the safety net.
 *
 * The failure that actually threatens this feature looks IDENTICAL to success from inside the
 * process: if the proxy chain drops the visitor's address and the last hop substitutes its own,
 * every request arrives as a well-formed `x-forwarded-for` holding the SAME value. There is no
 * signal in a single request that distinguishes "one person applying four times" from "four people
 * sharing one bucket", so no amount of cleverness here can settle it — it can only be MEASURED
 * against the deployment, from two different networks, and then pinned. The spec carries the probe
 * and `ACCESS_APPLY_PER_IP_LIMIT=0` is the one-env-var fix if the measurement comes back bad.
 */
export type IpSource = "cf" | "forwarded" | "real-ip" | "none";

export interface ClientIp {
  readonly key: string;
  readonly source: IpSource;
}

export interface ClientIpOptions {
  /**
   * Whether Cloudflare genuinely fronts this deployment. Default **false** — a header is only
   * evidence if something upstream is known to overwrite it, and trusting one that nothing
   * overwrites is worse than ignoring it.
   */
  readonly trustCloudflare?: boolean;
}

export function clientIp(headers: Headers, options: ClientIpOptions = {}): ClientIp {
  if (options.trustCloudflare) {
    const cf = headers.get("cf-connecting-ip")?.trim();
    if (cf) return { key: cf, source: "cf" };
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return { key: first, source: "forwarded" };
  }

  const real = headers.get("x-real-ip")?.trim();
  if (real) return { key: real, source: "real-ip" };

  return { key: "unknown", source: "none" };
}
