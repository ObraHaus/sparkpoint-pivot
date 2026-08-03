"use client";

/**
 * usePrefs — device-local /settings preferences on top of useLocalState (feature 016).
 * Persistence + SSR-safety live in useLocalState; this layer adds the typed shape, safe coercion
 * (schema drift → complete object), and per-field setters. Notification delivery is not wired in
 * alpha — these record intent; density + reduced-motion are applied by <PrefsEffect/>.
 */

import { useCallback } from "react";
import { useLocalState } from "@/lib/ui/useLocalState";
import {
  coerceDisplayPrefs,
  coerceNotifPrefs,
  DEFAULT_DISPLAY_PREFS,
  DEFAULT_NOTIF_PREFS,
  DISPLAY_STORAGE_KEY,
  NOTIF_STORAGE_KEY,
  type Density,
  type DisplayPrefs,
  type NotifKey,
  type NotifPrefs,
} from "./prefs";

export function useNotifPrefs(): { prefs: NotifPrefs; setNotif: (key: NotifKey, on: boolean) => void } {
  const [raw, setRaw] = useLocalState<NotifPrefs>(NOTIF_STORAGE_KEY, DEFAULT_NOTIF_PREFS);
  const prefs = coerceNotifPrefs(raw);
  const setNotif = useCallback(
    (key: NotifKey, on: boolean) => setRaw({ ...coerceNotifPrefs(raw), [key]: on }),
    [raw, setRaw],
  );
  return { prefs, setNotif };
}

export function useDisplayPrefs(): {
  prefs: DisplayPrefs;
  setDensity: (density: Density) => void;
  setExpandSources: (expand: boolean) => void;
  setReducedMotion: (on: boolean) => void;
} {
  const [raw, setRaw] = useLocalState<DisplayPrefs>(DISPLAY_STORAGE_KEY, DEFAULT_DISPLAY_PREFS);
  const prefs = coerceDisplayPrefs(raw);
  const setDensity = useCallback(
    (density: Density) => setRaw({ ...coerceDisplayPrefs(raw), density }),
    [raw, setRaw],
  );
  const setReducedMotion = useCallback(
    (on: boolean) => setRaw({ ...coerceDisplayPrefs(raw), reducedMotion: on }),
    [raw, setRaw],
  );
  const setExpandSources = useCallback(
    (on: boolean) => setRaw({ ...coerceDisplayPrefs(raw), expandSources: on }),
    [raw, setRaw],
  );

  return { prefs, setDensity, setReducedMotion, setExpandSources };
}
