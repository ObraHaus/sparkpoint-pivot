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

/** Signing envelope for the build: the default user-signed path, or the US6 session-key path. */
export type BuildExecMode = "per_action" | "session_key";

export interface BuildTxState {
  bundle: IntentBundle | null;
  error: AgentApiError | null;
  loading: boolean;
  /**
   * Build (or re-build) a bundle for `action`. Each call yields a FRESH bundle (fresh sim + expiry).
   * `execMode` defaults to `per_action` (user-signed); `session_key` (US6) makes the server emit the
   * unsigned v0.7 userOp on `bundle.userOp`. Returns the bundle (or `null` on a refusal) so a caller
   * that must chain build→sign can read it directly; the returned bundle is also mirrored to `bundle`.
   */
  build: (action: ProposedAction, execMode?: BuildExecMode) => Promise<IntentBundle | null>;
}

export function useBuildTx(): BuildTxState {
  const { client } = useAgentClient();
  const [bundle, setBundle] = useState<IntentBundle | null>(null);
  const [error, setError] = useState<AgentApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const build = useCallback(
    async (action: ProposedAction, execMode: BuildExecMode = "per_action"): Promise<IntentBundle | null> => {
      if (!client) return null;
      setLoading(true);
      setError(null);
      setBundle(null);
      try {
        const res = await client.request<{ intentBundle: IntentBundle }>("/build-tx", {
          method: "POST",
          body: { action, execMode },
        });
        setBundle(res.intentBundle);
        return res.intentBundle;
      } catch (e) {
        setError(
          e instanceof AgentApiError
            ? e
            : new AgentApiError({ code: "INTERNAL", httpStatus: 0, message: "Couldn't build the transaction." }),
        );
        return null;
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  return { bundle, error, loading, build };
}
