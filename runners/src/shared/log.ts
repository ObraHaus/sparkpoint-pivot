import { formatEther } from "viem";
import { beat } from "./health.ts";

/**
 * Logging, in units of money moved rather than calls made.
 *
 * "swept the curve" tells an operator a function ran. "swept 0.0510 ETH -> 0.0459 pot / 0.0051
 * treasury" tells them whether the demo is working, and it is the only line that would have caught
 * a sweep that succeeded against an empty contract.
 */
/** Only two runners exist off the simulation: the trader and the faucet are sim-only. */
export type Service = "keeper" | "sweeper" | "curator" | "deployer";

function stamp(): string {
  return new Date().toISOString();
}

/**
 * The last lines each service emitted, in memory.
 *
 * ⚠️ This exists because Coolify's log endpoint returns **one arbitrary container** for a whole
 * compose application, and would not give up the trader's. For an hour I could not tell whether the
 * simulation was producing volume — a question the logs answer immediately and nothing else did.
 *
 * In memory and bounded: a restart loses them, which is correct. This is a window onto what a
 * service is doing right now, not a log store, and a service that keeps its whole history in RAM is
 * a service that eventually falls over for a reason unrelated to its job.
 */
const RECENT_LINES = Number(process.env.LOG_RING_LINES ?? 200);
const recent = new Map<Service, string[]>();

/** The last lines `service` emitted, oldest first. */
export function recentLines(service: Service): string[] {
  return recent.get(service)?.slice() ?? [];
}

function emit(service: Service, level: "info" | "warn" | "error", message: string): void {
  const line = `${stamp()} ${level.padEnd(5)} ${service.padEnd(7)} ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  const ring = recent.get(service) ?? [];
  ring.push(line);
  while (ring.length > RECENT_LINES) ring.shift();
  recent.set(service, ring);
}

export function logger(service: Service) {
  // ⚠️ Set when this service has hit a condition that stops it working at all, as opposed to a
  // revert it is expected to shrug off. `forever` reads it to decide whether the tick counts as a
  // heartbeat: a service that cannot work must not look alive.
  let broken = false;

  return {
    /** True if a fatal condition was reported since the last check, and clears it. */
    takeBroken: () => {
      const was = broken;
      broken = false;
      return was;
    },

    /**
     * Peek at the fatal flag WITHOUT clearing it — the counterpart to `takeBroken`.
     *
     * ⚠️ For heartbeating mid-tick: a long delivery loop beats on progress so a healthy keeper is not
     * marked unhealthy for outlasting the window, but it must stop beating the moment a fatal
     * condition (out of gas) is flagged, or an out-of-gas keeper would look alive. `takeBroken` can't
     * serve that: clearing the flag here would hide the failure from `forever`'s end-of-tick check.
     */
    healthy: () => !broken,

    /**
     * Report that this service cannot do its job, for a reason it will not recover from on its own.
     *
     * ⚠️ The counterpart to `expected`. A single revert is normal; a service where **every attempt
     * fails, tick after tick**, is not — and because each individual failure is "expected", nothing
     * else notices. The trader can lose its trading venue entirely and keep heartbeating, so the
     * container stays healthy while the demo produces nothing at all.
     */
    cannotWork: (why: string) => {
      emit(service, "error", `${why} — this service is not doing its job`);
      broken = true;
    },

    info: (message: string) => emit(service, "info", message),
    warn: (message: string) => emit(service, "warn", message),
    error: (message: string) => emit(service, "error", message),

    /** An amount of ETH, to four places — enough to see a fee, short enough to scan. */
    eth: (wei: bigint) => `${Number(formatEther(wei)).toFixed(4)} ETH`,

    /**
     * A failure that is expected and survivable, logged without alarm.
     *
     * These services must not stall on a reverted trade or a sweep with nothing to sweep. Treating
     * every revert as an incident trains an operator to ignore the log, which is worse than not
     * having one.
     */
    expected: (what: string, error: unknown) => {
      const detail = (error instanceof Error ? error.message.split("\n")[0] : String(error)) ?? "";

      // ⚠️ Running out of gas is NOT an expected condition, and it arrives looking exactly like
      // one: viem reports it as a failed transaction, so it lands here with everything else. A
      // sweeper with an empty wallet cannot do its job at all, and the first containerised run
      // logged exactly that at info level, once a minute, indistinguishable from "nothing to
      // sweep". A service that cannot work must say so in a voice that carries.
      if (/total cost|insufficient funds|exceeds the balance/i.test(detail)) {
        emit(service, "error", `${what} FAILED: out of gas. This service cannot work. ${detail}`);
        broken = true;
        return;
      }
      emit(service, "info", `${what} (expected, continuing): ${detail}`);
    },
  };
}

export type Log = ReturnType<typeof logger>;

/**
 * Run `body` forever, surviving anything it throws.
 *
 * A crash loop that takes the whole service down means the demo stops for a reason a viewer will
 * read as "the product is broken". Constitution IV says a service stopping must be a delay — this
 * is where that is implemented.
 */
export async function forever(
  log: Log,
  name: string,
  intervalMs: () => number,
  body: () => Promise<void>,
  service?: Service,
): Promise<void> {
  for (;;) {
    let ok = true;
    try {
      await body();
    } catch (error) {
      ok = false;
      log.error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // ⚠️ Three ways a tick fails to count: it threw, it reported a fatal condition through
    // `log.expected`, or the caller never asked for a heartbeat. `takeBroken()` is called
    // unconditionally so the flag is cleared either way — a single out-of-gas tick must not mark
    // the service broken forever once it has been funded again.
    const wasBroken = log.takeBroken();
    if (service && ok && !wasBroken) beat(service);

    await new Promise((resolve) => setTimeout(resolve, intervalMs()));
  }
}
