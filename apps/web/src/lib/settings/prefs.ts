/**
 * settings/prefs — the typed, dependency-free core for the per-device /settings preferences
 * (feature 016). Notification toggles + display (density, reduced motion) are persisted in
 * localStorage via useLocalState (see usePrefs.ts); this module owns the SHAPE and the safe
 * coercion so a partial or corrupt stored blob (schema drift, hand-edited value) always resolves
 * to a complete, sane object. No React, no `window` — unit-testable in isolation.
 *
 * Honesty: these are DEVICE-LOCAL preferences. Notification *delivery* is not wired in alpha (the
 * bell panel is showcase data), so the notif toggles record intent for when it is; density +
 * reduced-motion are applied to the live app (data-* on <html> + CSS). See usePrefs.ts / PrefsEffect.
 */

export const NOTIF_KEYS = [
  "txResults",
  "rateChanges",
  "capsNearLimit",
  "sessionKeyExpiry",
  "outcomeUpdates",
] as const;

export type NotifKey = (typeof NOTIF_KEYS)[number];
export type NotifPrefs = Record<NotifKey, boolean>;

export type Density = "comfortable" | "compact";
export interface DisplayPrefs {
  density: Density;
  reducedMotion: boolean;
}

/** localStorage keys — versioned + `sp.` namespaced to match sp.swap.imported.v1 / sp-theme. */
export const NOTIF_STORAGE_KEY = "sp.settings.notifications.v1";
export const DISPLAY_STORAGE_KEY = "sp.settings.display.v1";

/** Defaults preserve the design's original states: first three notifications on, rest off. */
export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  txResults: true,
  rateChanges: true,
  capsNearLimit: true,
  sessionKeyExpiry: false,
  outcomeUpdates: false,
};

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  density: "comfortable",
  reducedMotion: false,
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

/** Merge an untrusted parsed value over the notif defaults: unknown keys dropped, bad types ignored. */
export function coerceNotifPrefs(raw: unknown): NotifPrefs {
  const out: NotifPrefs = { ...DEFAULT_NOTIF_PREFS };
  if (raw && typeof raw === "object") {
    for (const k of NOTIF_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (isBool(v)) out[k] = v;
    }
  }
  return out;
}

/** Same for display prefs — only the two known fields, each validated against its domain. */
export function coerceDisplayPrefs(raw: unknown): DisplayPrefs {
  const out: DisplayPrefs = { ...DEFAULT_DISPLAY_PREFS };
  if (raw && typeof raw === "object") {
    const d = (raw as Record<string, unknown>).density;
    if (d === "comfortable" || d === "compact") out.density = d;
    const rm = (raw as Record<string, unknown>).reducedMotion;
    if (isBool(rm)) out.reducedMotion = rm;
  }
  return out;
}

/** The `data-*` attributes PrefsEffect stamps on <html>. Comfortable / motion-on = absent (null),
 * which keeps the default DOM clean (mirrors how absence of the attr means normal density). Pure. */
export function displayAttrs(p: DisplayPrefs): { density: string | null; reducedMotion: string | null } {
  return {
    density: p.density === "compact" ? "compact" : null,
    reducedMotion: p.reducedMotion ? "true" : null,
  };
}
