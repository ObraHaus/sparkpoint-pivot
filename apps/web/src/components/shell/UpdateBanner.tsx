"use client";

/**
 * UpdateBanner (feature 006, US1 + US2). When a newer build is live it announces the update and, after
 * a non-cancellable 60s countdown, reloads onto it — but NEVER while a funds- or data-sensitive op is
 * in flight, and NEVER on the non-custody escape hatches (/exit, /trust — N2).
 *
 * Safety, in order of priority:
 *  - Hard route exclusion: /exit + /trust never auto-reload, regardless of the critical-op counters
 *    (between RPC reads the LOCKED hold on /exit is 0, so pathname is the real guard).
 *  - Pause: the countdown FREEZES while `locked || busy`; it never reloads through a signature,
 *    a broadcast-but-unconfirmed tx, a streaming answer, an unsent draft, or a dirty admin editor.
 *  - Max-defer: a stuck op cannot postpone forever — after 10 min the reload fires as soon as it is
 *    not LOCKED (a BUSY-only state no longer blocks it).
 *  - Loop-breaker: if a reload for a given build id does not clear the mismatch within ~30s, stop
 *    auto-reloading and offer a manual Refresh (a broken deploy must not brick the app).
 *  - beforeunload: while locked || busy, a native "leave site?" prompt guards a manual close/refresh.
 *
 * The whole component is DORMANT unless NEXT_PUBLIC_FORCE_REFRESH is "true" (env.forceRefresh) — it
 * renders null and installs nothing until the feature is enabled (Phase 7).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { env } from "@/lib/env";
import { Icon } from "@/lib/icons";
import { useVersionCheck } from "@/lib/useVersionCheck";
import { useCriticalOp } from "@/lib/ui/useCriticalOp";
import { isLocked } from "@/lib/ui/criticalOp";
import { installChunkGuard } from "@/lib/ui/chunkGuard";

const COUNTDOWN_SECS = 60;
const MAX_DEFER_MS = 10 * 60 * 1000; // 10 min — a stuck op can't defer past this (but /exit still never reloads)
const LOOPBREAK_MAX_RELOADS = 2; // after N auto-reloads for a build that don't clear the mismatch → manual Refresh
const EXCLUDED = ["/exit", "/trust"]; // N2 — never auto-reload these, independent of the counters

function isExcluded(pathname: string): boolean {
  return EXCLUDED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function UpdateBanner() {
  const enabled = env.forceRefresh;
  const { updateAvailable, serverVersion } = useVersionCheck(60_000);
  const { locked, busy } = useCriticalOp();
  const pathname = usePathname();

  const [secs, setSecs] = useState(COUNTDOWN_SECS);
  const [loopBroken, setLoopBroken] = useState(false);
  const firstSeen = useRef<{ id: string; at: number } | null>(null);

  const show = enabled && updateAvailable && !!serverVersion && !isExcluded(pathname);
  const paused = locked || busy;

  // Independent ChunkLoadError backstop — install once, only when the feature is enabled.
  useEffect(() => {
    if (enabled) installChunkGuard();
  }, [enabled]);

  // Reload once, respecting the LOCKED guard. Increments a per-build reload COUNTER before reloading;
  // the arm effect reads the count on the next load — a build whose reload never clears the mismatch
  // trips the loop-breaker after LOOPBREAK_MAX_RELOADS. (A wall-clock window would be racier than the
  // >=2-read re-detection latency and could never engage.)
  const performReload = useCallback((id: string) => {
    if (isLocked()) return; // defense in depth — never reload through a signature/broadcast
    try {
      const key = `sp-loopbreak-${id}`;
      const n = Number(window.sessionStorage.getItem(key)) || 0;
      window.sessionStorage.setItem(key, String(n + 1));
    } catch {
      /* private mode — proceed with the reload */
    }
    window.location.reload();
  }, []);

  // Stamp firstSeen (per build id) and (re)arm the countdown when a new build first appears.
  useEffect(() => {
    if (!show || !serverVersion) {
      firstSeen.current = null;
      return;
    }
    if (!firstSeen.current || firstSeen.current.id !== serverVersion) {
      firstSeen.current = { id: serverVersion, at: Date.now() };
      // Loop-breaker: if we've already auto-reloaded for THIS build id enough times and STILL see the
      // mismatch, a reload won't help (broken deploy) — stop auto-reloading and offer manual Refresh.
      let looped = false;
      try {
        const n = Number(window.sessionStorage.getItem(`sp-loopbreak-${serverVersion}`)) || 0;
        looped = n >= LOOPBREAK_MAX_RELOADS;
      } catch {
        looped = false;
      }
      setSecs(COUNTDOWN_SECS);
      setLoopBroken(looped);
    }
  }, [show, serverVersion]);

  // The countdown / reload driver. Re-runs each second and on locked/busy transitions.
  useEffect(() => {
    if (!show || !serverVersion || loopBroken) return;
    if (paused) return; // freeze the countdown while a critical/busy op is active
    if (secs <= 0) {
      performReload(serverVersion);
      return;
    }
    const t = window.setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [show, serverVersion, loopBroken, paused, secs, performReload]);

  // Max-defer: a stuck op can't postpone forever. A timer armed independently of the countdown (which
  // freezes while paused) forces a reload at firstSeen + 10 min — but ONLY when not LOCKED, so it never
  // reloads through a signature/broadcast; /exit + /trust are already excluded via `show`.
  useEffect(() => {
    if (!show || !serverVersion || loopBroken) return;
    const seen = firstSeen.current;
    if (!seen || seen.id !== serverVersion) return;
    const remaining = Math.max(0, seen.at + MAX_DEFER_MS - Date.now());
    const t = window.setTimeout(() => {
      if (!isLocked()) performReload(serverVersion);
    }, remaining);
    return () => window.clearTimeout(t);
  }, [show, serverVersion, loopBroken, performReload]);

  // beforeunload guard — warn on a manual close/refresh while a funds or data op is active.
  useEffect(() => {
    if (!enabled || !paused) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [enabled, paused]);

  if (!show || !serverVersion) return null;

  const body = loopBroken
    ? "Refresh to load the latest version of SparkPoint."
    : paused
      ? "We’ll refresh automatically once your current action finishes."
      : `Reloading in ${secs}s to keep you on the latest version.`;

  return (
    <div
      className="tipcard tipcard-ann"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        width: 320,
        margin: 0,
        zIndex: 80,
        boxShadow: "var(--shadow-md)",
      }}
    >
      <div className="tipcard-hd">
        <span className="tipcard-eyebrow">
          <Icon name="refresh" size={12} /> Update ready
        </span>
      </div>
      <div className="tipcard-title">A new version of SparkPoint</div>
      <div className="tipcard-body">{body}</div>
      <div className="tipcard-ft">
        {!loopBroken && !paused ? <span className="tipcard-count tnum">{secs}s</span> : <span />}
        <button
          className="btn btn-primary btn-sm"
          disabled={locked}
          onClick={() => {
            if (loopBroken) {
              if (!isLocked()) window.location.reload(); // user-initiated — bypass the auto loop-breaker
            } else {
              performReload(serverVersion);
            }
          }}
        >
          {loopBroken ? "Refresh" : "Reload now"}
        </button>
      </div>
    </div>
  );
}
