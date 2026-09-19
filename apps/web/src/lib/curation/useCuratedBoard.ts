"use client";

/**
 * 048 — the `/vault` board's data seam. One read of `GET /vaults/curated` through the same-origin
 * BFF (which injects the SIWE identity + the S2S bearer; the browser never sees either).
 *
 * No polling: the board changes once a day at most, and the admin "Run now" path is on the admin
 * panel. A failed read surfaces as `error` — the board renders the honest unavailable state rather
 * than an empty market. `fetchedAt` is stamped when data arrives so relative-time rendering never
 * reads the clock during render (an impure render trips the purity lint and makes SSR disagree).
 */

import { useEffect, useState } from "react";
import { APP_CHAIN_ID_HEADER } from "@/lib/chain/appChain";

import type { CurationBoard } from "./model";

export interface CuratedBoardState {
  board: CurationBoard | null;
  state: "loading" | "ok" | "error";
  fetchedAt: number;
  reload: () => void;
}

export function useCuratedBoard(): CuratedBoardState {
  const [board, setBoard] = useState<CurationBoard | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [fetchedAt, setFetchedAt] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    // The fetch lives INSIDE the effect and setState happens only in its promise callbacks (never
    // synchronously in the effect body), which is both the correct data-fetching shape and what
    // `react-hooks/set-state-in-effect` asks for.
    const load = () =>
      fetch("/api/agent/vaults/curated", {
        headers: { "x-chain-id": APP_CHAIN_ID_HEADER },
        cache: "no-store",
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: CurationBoard) => {
          if (!live) return;
          setBoard(data);
          setFetchedAt(Date.now());
          setState("ok");
        })
        .catch(() => {
          if (live) setState("error");
        });
    void load();
    return () => {
      live = false;
    };
  }, [reloadKey]);

  return { board, state, fetchedAt, reload: () => setReloadKey((k) => k + 1) };
}
