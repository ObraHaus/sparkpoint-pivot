"use client";

/**
 * useBuildTx (feature 019 US2) — materialize a signable IntentBundle from a ProposedAction.
 *
 * Calls `POST /build-tx` through the same-origin BFF via the typed `AgentClient` (which fail-closes
 * any body carrying a signature — the build body carries NONE, so it passes). The response is either
 * one `IntentBundle` (approved, simulated, recipient forced to you) or a typed `AgentApiError` with
 * reasons and NO bundle (fail-closed, VR-X3). The drawer renders whichever it gets.
 */

import { useCallback, useState } from "react";

import { AgentApiError } from "@/lib/agent/client";
import { useAgentClient } from "@/lib/agent/useAgent";
import type { IntentBundle, ProposedAction } from "@sparkpoint/shared/schemas";

export interface BuildTxState {
  bundle: IntentBundle | null;
  error: AgentApiError | null;
  loading: boolean;
  /** Build (or re-build) a bundle for `action`. Each call yields a FRESH bundle (fresh sim + expiry). */
  build: (action: ProposedAction) => Promise<void>;
}

export function useBuildTx(): BuildTxState {
  const { client } = useAgentClient();
  const [bundle, setBundle] = useState<IntentBundle | null>(null);
  const [error, setError] = useState<AgentApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const build = useCallback(
    async (action: ProposedAction) => {
      if (!client) return;
      setLoading(true);
      setError(null);
      setBundle(null);
      try {
        const res = await client.request<{ intentBundle: IntentBundle }>("/build-tx", {
          method: "POST",
          body: { action, execMode: "per_action" },
        });
        setBundle(res.intentBundle);
      } catch (e) {
        setError(
          e instanceof AgentApiError
            ? e
            : new AgentApiError({ code: "INTERNAL", httpStatus: 0, message: "Couldn't build the transaction." }),
        );
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  return { bundle, error, loading, build };
}
