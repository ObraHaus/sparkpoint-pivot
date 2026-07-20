"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  beginCriticalOp,
  getCriticalSnapshot,
  SERVER_SNAPSHOT,
  subscribeCriticalOp,
  type CriticalSnapshot,
  type Severity,
} from "./criticalOp";

/** Subscribe to the global critical-op signal. */
export function useCriticalOp(): CriticalSnapshot {
  return useSyncExternalStore(subscribeCriticalOp, getCriticalSnapshot, () => SERVER_SNAPSHOT);
}

/** Hold `severity` for as long as `active` is true; releases on cleanup/unmount. */
export function useHoldCriticalOp(active: boolean, severity: Severity): void {
  useEffect(() => {
    if (!active) return;
    return beginCriticalOp(severity);
  }, [active, severity]);
}
