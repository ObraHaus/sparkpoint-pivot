"use client";

/**
 * Which broker ids a wallet holds, from the indexer — with the direct-chain scan as a fallback.
 *
 * `SparkyBroker` is solady ERC-721 and **not enumerable**, so this cannot be asked of the contract.
 * Two independent paths answer it, and having both is the point:
 *
 *   1. `GET /brokers/owned` — the agent walks `Transfer` logs. Scales to the full 10,000.
 *   2. The page's own `1..totalMinted` scan — bounded, browser-side, needs no backend.
 *
 * The indexer is preferred because it scales; the scan survives an agent outage, since the browser
 * can still read the chain directly. Neither is allowed to be silently wrong: the indexer reports
 * `available: false` rather than an empty list when it cannot read, and the scan reports when it
 * truncated. An empty gallery is only ever shown when the wallet genuinely holds nothing.
 */

import { useEffect, useState } from "react";

export type OwnedSource = "indexer" | "scan" | "loading";

export interface OwnedResult {
  /** Ids from the indexer, or `undefined` when it could not answer and the scan should be used. */
  readonly ids?: number[];
  readonly source: OwnedSource;
}

export function useIndexedBrokers(enabled: boolean): OwnedResult {
  const [state, setState] = useState<OwnedResult>({ source: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agent/brokers/owned", { credentials: "include" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { available?: boolean; tokenIds?: number[] };
        if (cancelled) return;
        // `available: false` means the chain could not be read — fall back to the scan rather than
        // rendering "you own nothing", which is the one wrong answer here.
        if (body.available === true && Array.isArray(body.tokenIds)) {
          setState({ ids: body.tokenIds, source: "indexer" });
        } else {
          setState({ source: "scan" });
        }
      } catch {
        if (!cancelled) setState({ source: "scan" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Derived rather than written from the effect: with no wallet on the right chain there is
  // nothing to ask the indexer, and setting that synchronously inside the effect is both a lint
  // error and an extra render.
  return enabled ? state : { source: "scan" };
}
