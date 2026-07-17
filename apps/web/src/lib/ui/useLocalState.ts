"use client";

/**
 * useLocalState — a tiny SSR-safe localStorage-backed state hook (via useSyncExternalStore, the
 * same technique OverlayProvider uses to avoid hydration mismatch). Used by the sidebar tip widget
 * to remember a dismissed announcement id + the current tip index across reloads. Reads/writes are
 * JSON; a corrupt/absent value falls back to the initial. Never throws (private mode / no storage).
 */

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — dismissal simply won't persist */
  }
}

export function useLocalState<T>(key: string, initial: T): [T, (next: T) => void] {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) cb();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }, [key]);

  const getSnapshot = useCallback(() => readRaw(key), [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null); // server snapshot = null

  let value: T = initial;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = initial;
    }
  }

  const setValue = useCallback(
    (next: T) => {
      writeRaw(key, JSON.stringify(next));
      notify();
    },
    [key],
  );

  return [value, setValue];
}
