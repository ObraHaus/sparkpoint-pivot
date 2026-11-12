"use client";

/**
 * 077 — protocol switch for the shared live earn route.
 *
 * The flags are OFF by default: with no `NEXT_PUBLIC_EARN_LIVE_*` the route says so plainly and
 * offers no wallet action. When on, it renders the Kamino (Solana) or Morpho (Base) flow and
 * keeps the same review → explicit wallet confirm shape for both.
 *
 * 073 — every protocol now renders the SAME deposit/withdraw layout (back link, H1 + subtitle +
 * risk pill, amount card + Max, summary box, disclaimer, primary button, next-step line). This
 * switch only chooses the protocol container; it never re-implements the visual layout.
 */

import { toHref } from "@/lib/nav";
import {
  protocolLiveEnabled,
  type LiveEarnMode,
  type LiveEarnProtocol,
} from "@/lib/earn/liveFlags";
import { findKaminoVault } from "@/lib/earn/kaminoLive";
import { findMorphoVault } from "@/lib/earn/morphoLive";
import { KaminoLiveFlow } from "@/components/vault/KaminoLiveFlow";
import { MorphoLiveFlow } from "@/components/vault/MorphoLiveFlow";
import { FlowNextStep, FlowNotice, VaultFlowPage } from "@/components/vault/VaultFlow";
import { VAULT_FLOW_NEXT_STEP, vaultFlowTitle } from "@/lib/vault/vaultFlow";

export interface LiveEarnFlowProps {
  readonly protocol: LiveEarnProtocol;
  readonly vault: string | null;
  readonly chain: string | null;
  readonly asset: string | null;
  readonly mode: LiveEarnMode;
  readonly initialAmount: string | null;
}

const UNKNOWN_NOTICE =
  "This vault isn't available for live deposits here yet. Pick one of the curated vaults below; " +
  "the other option stays a preview.";

export function LiveEarnFlow({ protocol, vault, chain, asset, mode, initialAmount }: LiveEarnFlowProps) {
  const enabled = protocolLiveEnabled(protocol);

  if (!enabled) {
    const label = protocol === "kamino" ? "Kamino" : "Morpho";
    return (
      <VaultFlowPage
        backHref={toHref("vault")}
        title={vaultFlowTitle(mode, asset ?? "vault")}
        subtitle={`Live ${label} earn isn't available right now`}
        riskTier={2}
        testId="live-earn-disabled"
      >
        <FlowNotice tone="caution">
          Live deposits aren&apos;t available here yet. The Vault page still shows the vault and its
          preview; nothing is signed or sent.
        </FlowNotice>
        <FlowNextStep>{VAULT_FLOW_NEXT_STEP}</FlowNextStep>
      </VaultFlowPage>
    );
  }

  if (protocol === "kamino") {
    const unknown = vault !== null && vault !== "" && findKaminoVault(vault) === null;
    return (
      <KaminoLiveFlow
        vault={unknown ? null : vault}
        mode={mode}
        initialAmount={initialAmount}
        notice={unknown ? UNKNOWN_NOTICE : null}
      />
    );
  }

  const unknown = vault !== null && vault !== "" && findMorphoVault(vault) === null;
  return (
    <MorphoLiveFlow
      vault={unknown ? null : vault}
      chain={chain}
      asset={asset}
      mode={mode}
      initialAmount={initialAmount}
      notice={unknown ? UNKNOWN_NOTICE : null}
    />
  );
}
