import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Regression: 049 added SERVICE=deployer to the image but not to this check, so the deployer's
// HEALTHCHECK exited 1 forever and Coolify stopped the container as soon as it started it.
function runHealthcheck(service: string): { out: string; code: number } {
  const heartbeatDir = mkdtempSync(join(tmpdir(), "sparky-healthcheck-"));
  writeFileSync(join(heartbeatDir, service), "");
  try {
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", "src/healthcheck.ts"],
      { env: { ...process.env, SERVICE: service, HEARTBEAT_DIR: heartbeatDir }, encoding: "utf8" },
    );
    return { out, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

test("healthcheck accepts SERVICE=deployer when its heartbeat is fresh", () => {
  const { out, code } = runHealthcheck("deployer");
  assert.equal(code, 0);
  assert.match(out, /deployer: heartbeat fresh/);
});

test("healthcheck rejects an unknown SERVICE", () => {
  const { out, code } = runHealthcheck("bogus");
  assert.notEqual(code, 0);
  assert.match(out, /SERVICE must be/);
});
