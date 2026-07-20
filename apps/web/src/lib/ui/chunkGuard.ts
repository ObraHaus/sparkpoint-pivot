"use client";

import { isLocked } from "./criticalOp";

/**
 * ChunkLoadError backstop (feature 006). Independent of the version banner: if a stale tab requests a
 * chunk the new container no longer serves, hard-reload ONCE to pick up the new build. Never reloads
 * while a funds-critical op is LOCKED, and a sessionStorage timestamp prevents a genuinely-broken
 * build from looping. Not installed until the feature mounts (see providers wiring in a later phase).
 */

const RELOAD_KEY = "sp-chunk-reload-at";
const CHUNK_RE =
  /ChunkLoadError|Loading chunk\s+\S+\s+failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i;

/** Pure predicate (unit-testable). */
export function isChunkLoadError(message: string): boolean {
  return CHUNK_RE.test(message);
}

let installed = false;

export function installChunkGuard(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const maybeReload = (message: string): void => {
    if (!isChunkLoadError(message)) return;
    if (isLocked()) return; // never reload through a signature/broadcast
    let last = 0;
    try {
      last = Number(window.sessionStorage.getItem(RELOAD_KEY)) || 0;
    } catch {
      last = 0;
    }
    const now = Date.now();
    if (now - last < 10_000) return; // reloaded within 10s → don't loop
    try {
      window.sessionStorage.setItem(RELOAD_KEY, String(now));
    } catch {
      /* private mode — best effort */
    }
    window.location.reload();
  };

  window.addEventListener("error", (e: ErrorEvent) =>
    maybeReload(String(e?.message ?? e?.error ?? "")),
  );
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) =>
    maybeReload(String(e?.reason ?? "")),
  );
}
