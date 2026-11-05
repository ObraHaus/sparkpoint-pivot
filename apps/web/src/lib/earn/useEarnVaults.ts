"use client";

/**
 * Read-only seam for the agent's data-driven earn registry (069/070/071).
 *
 * The same `/earn/vaults` snapshot that backs Sparky's chat card powers the manual Vault page, so
 * the page and the chat can never disagree about Morpho on Base, Kamino on Solana or Rhea on NEAR.
 * Nothing here signs, quotes or moves funds; a failed read is surfaced as `error` so the page can
 * show an honest unavailable state instead of an empty market.
 */

import { useQuery } from "@tanstack/react-query";
import { EarnVaultSchema, type EarnVault } from "@sparkpoint/shared/schemas";

import { useAgentClient } from "@/lib/agent/useAgent";

export interface EarnSnapshotMeta {
  state: "ready" | "unavailable";
  source?: string | null;
  ageMinutes?: number | null;
  fetchedAt?: string | null;
}

export interface EarnVaultsView {
  vaults: EarnVault[];
  snapshot: EarnSnapshotMeta | null;
  featureEnabled: boolean;
  loading: boolean;
  error: string | null;
  online: boolean;
  refetch: () => void;
}

interface EarnVaultsResponse {
  featureEnabled?: unknown;
  snapshot?: unknown;
  vaults?: unknown;
}

function parseSnapshot(raw: unknown): EarnSnapshotMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const state = value.state === "ready" ? "ready" : "unavailable";
  return {
    state,
    source: typeof value.source === "string" ? value.source : null,
    ageMinutes: typeof value.ageMinutes === "number" ? value.ageMinutes : null,
    fetchedAt: typeof value.fetchedAt === "string" ? value.fetchedAt : null,
  };
}

export function useEarnVaults(): EarnVaultsView {
  const { client, online, identity } = useAgentClient();
  const query = useQuery({
    queryKey: ["agent", "earn", "vaults", identity?.account, identity?.chainId],
    enabled: online,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const raw = await client!.request<unknown>("/earn/vaults?limit=200&sort=tvl", { signal });
      if (!raw || typeof raw !== "object") throw new Error("The earn registry response couldn't be read.");
      const body = raw as EarnVaultsResponse;
      if (!Array.isArray(body.vaults)) throw new Error("The earn registry returned no vault list.");
      const vaults: EarnVault[] = [];
      for (const item of body.vaults) {
        const parsed = EarnVaultSchema.safeParse(item);
        if (parsed.success) vaults.push(parsed.data);
      }
      if (body.vaults.length > 0 && vaults.length === 0) {
        throw new Error("The earn registry response couldn't be verified.");
      }
      return {
        vaults,
        snapshot: parseSnapshot(body.snapshot),
        featureEnabled: body.featureEnabled !== false,
      };
    },
  });

  return {
    vaults: query.data?.vaults ?? [],
    snapshot: query.data?.snapshot ?? null,
    featureEnabled: query.data?.featureEnabled ?? true,
    loading: online && query.isLoading,
    error: query.error ? query.error.message : null,
    online,
    refetch: () => void query.refetch(),
  };
}
