import { isFresh } from "./shared/health.ts";

/**
 * The container healthcheck, as a process that exits 0 (healthy) or non-zero (unhealthy).
 *
 * This is the CLI half of `health.ts`: the runners *write* a heartbeat file after every tick that
 * actually completed and was not degraded, and this *reads* its age. A Docker/Coolify `HEALTHCHECK`
 * calls it every interval; anything non-zero flips the container to `unhealthy`.
 *
 * ⚠️ Why a file and not an HTTP probe: these processes hold a hot key, and a listening port is an
 * attack surface a keeper/sweeper has no reason to carry (`runners/README.md`). The heartbeat file
 * is the whole liveness contract, and it is deliberately more than "the process is up": a runner out
 * of gas, or one that cannot reach its RPC, keeps its process alive but stops writing the file — so
 * file age catches the failure that "is the PID there" cannot. A **missing** file is not fresh (see
 * `isFresh`): a container that has never completed a tick is not healthy.
 *
 * ⚠️ It imports only `isFresh` (which pulls in nothing but `node:fs`/`node:path`), never `chain.ts`
 * — this runs every 30 seconds and has no business loading viem or opening an RPC transport to
 * answer "did the last tick land". Env is read directly here for the same reason.
 */

/** Which service this container runs. Set per Coolify app; also selects which entry `CMD` starts. */
const SERVICE = process.env.SERVICE;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    // A misconfigured age is a configuration error, not a health verdict — fail loudly rather than
    // silently substituting a default that hides the typo.
    console.error(`${name}=${raw} is not a positive number`);
    process.exit(1);
  }
  return value;
}

if (SERVICE !== "keeper" && SERVICE !== "sweeper") {
  console.error(`SERVICE must be "keeper" or "sweeper" (got ${SERVICE ? `"${SERVICE}"` : "unset"})`);
  // Non-zero so a container started without SERVICE reports unhealthy rather than passing blindly.
  process.exit(1);
}

// The freshness window tracks the runner's own cadence: an idle tick still beats (there was nothing
// to do, but the loop ran), so a healthy runner refreshes the file every interval. Allow a few
// missed intervals plus a margin for a slow tick before calling it stale — long enough not to flap
// on one slow round, short enough to catch a wedged or unfunded runner within minutes. Override with
// HEALTHCHECK_MAX_AGE_SEC when a deployment's cadence differs.
const intervalSec = SERVICE === "keeper" ? envInt("KEEPER_TICK_SEC", 60) : envInt("SWEEP_INTERVAL_SEC", 300);
const maxAgeSec = envInt("HEALTHCHECK_MAX_AGE_SEC", intervalSec * 3 + 60);

if (isFresh(SERVICE, maxAgeSec)) {
  console.log(`${SERVICE}: heartbeat fresh (within ${maxAgeSec}s)`);
  process.exit(0);
}

console.error(`${SERVICE}: heartbeat is stale (older than ${maxAgeSec}s) or missing — unhealthy`);
process.exit(1);
