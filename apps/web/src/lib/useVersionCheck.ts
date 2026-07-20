"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CLIENT_BUILD_ID, isKnownId, isRealUpdate, parseVersion } from "./version";

/** One lightweight no-store GET; returns the server's release id or null on any uncertainty. */
async function fetchServerVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    return await parseVersion(res);
  } catch {
    return null; // network blip → no-op
  }
}

export interface VersionCheck {
  /** True once a *newer* server build is confirmed by two consecutive reads. */
  updateAvailable: boolean;
  /** The most recent server release id (or null). */
  serverVersion: string | null;
}

/**
 * Poll /api/version (default 60 s) + on window focus (react-query's default refetchOnWindowFocus is
 * on — the app's QueryClient has no overrides). A real update requires TWO consecutive differing
 * reads (debounces prod multi-replica skew during a rolling deploy). Never fires on uncertainty.
 */
export function useVersionCheck(pollMs = 60_000): VersionCheck {
  const query = useQuery({
    queryKey: ["app-version"],
    queryFn: fetchServerVersion,
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
    gcTime: pollMs,
  });

  const server = query.data ?? null;
  const serverKnown = isKnownId(server);
  const real = isRealUpdate(CLIENT_BUILD_ID, server);

  // Corroboration: require TWO consecutive differing reads before flagging (debounces prod
  // multi-replica skew during a rolling deploy). Tracked in an effect + state so the ref is never
  // read or written during render.
  const streak = useRef<{ at: number; count: number }>({ at: 0, count: 0 });
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (query.dataUpdatedAt === streak.current.at) return; // same fetch — nothing new
    streak.current = { ...streak.current, at: query.dataUpdatedAt };
    // Uncertainty is a NO-OP: a null / unknown server read must never de-latch a confirmed update or
    // reset the streak (the "uncertainty = do nothing" safety law). Only a KNOWN server id updates it.
    if (!serverKnown) return;
    if (real) {
      streak.current.count += 1;
      setUpdateAvailable(streak.current.count >= 2);
    } else {
      streak.current.count = 0; // server known AND equals client → legitimately back in sync
      setUpdateAvailable(false);
    }
  }, [query.dataUpdatedAt, real, serverKnown]);

  return { updateAvailable, serverVersion: server };
}
