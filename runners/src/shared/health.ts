import { mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Service } from "./log.ts";

/**
 * Liveness, as a file each service touches when it has actually done its job.
 *
 * ⚠️ The point is the distinction the first containerised run failed to make: a sweeper with an
 * empty wallet looks exactly like a sweeper with nothing to sweep. Both loop quietly forever. So the
 * heartbeat is written **only after a tick that completed and was not degraded** — a service that
 * cannot work goes stale within a few ticks and its container reports unhealthy, which is the one
 * signal an operator sees without reading logs.
 *
 * A file rather than an HTTP port because neither runner should ever listen on one: these
 * processes hold a hot key, and a port is an attack surface they have no reason to carry. Point a
 * container healthcheck at the file age.
 */
const DIR = process.env.HEARTBEAT_DIR ?? "/tmp/robin-brokers-runners";

export function heartbeatPath(service: Service | string): string {
  return join(DIR, String(service));
}

/** Record that `service` just completed a tick. */
export function beat(service: Service | string): void {
  const path = heartbeatPath(service);
  mkdirSync(DIR, { recursive: true });
  // Written once, then touched. utimesSync avoids rewriting a byte a minute for the life of a demo.
  try {
    utimesSync(path, new Date(), new Date());
  } catch {
    writeFileSync(path, "");
  }
}

/**
 * Whether `service` has beaten within `maxAgeSec`.
 *
 * ⚠️ A missing file is **not** fresh. A container that has never completed a tick is not healthy,
 * and treating "no evidence" as "fine" is the failure this whole file exists to avoid.
 */
export function isFresh(service: Service | string, maxAgeSec: number, now = Date.now()): boolean {
  try {
    const age = (now - statSync(heartbeatPath(service)).mtimeMs) / 1000;
    return age <= maxAgeSec;
  } catch {
    return false;
  }
}
