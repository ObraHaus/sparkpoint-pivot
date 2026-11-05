"use client";

import Link from "next/link";
import { Icon, SparkMark } from "@/lib/icons";
import { useNetwork } from "@/lib/network";
import { NetworkLogo } from "@/components/ui/NetworkLogo";
import { useNotifications } from "@/lib/agent/useAgent";
import { filterByPrefs, unreadCountOf } from "@/lib/agent/notificationsView";
import { useNotifPrefs } from "@/lib/settings/usePrefs";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import { PrimaryNav } from "@/components/shell/PrimaryNav";
import { StageBadge } from "@/components/ui/stage-badge";
import { NearWalletControl } from "@/components/near/NearWalletControl";
import { useNearWallet } from "@/lib/near/NearWalletProvider";
import { networkPillLabel } from "@/lib/networkPill";

export function TopBar({ active }: { active: string }) {
  const { network, wallet, isConnected, onSupportedChain, chainId, networkSettling } = useNetwork();
  // The network indicator is the honest combined state: the connected EVM chain plus the
  // client-side NEAR claim (when one is connected). NEAR is never server auth.
  const { accountId: nearAccountId } = useNearWallet();
  const ov = useOverlay();
  // The bell badge = the REAL unread count (§3.11), after the user's on-device category filter. 0
  // (no badge) when offline or all-read — honest, never a hardcoded number.
  const notif = useNotifications();
  const { prefs: notifPrefs } = useNotifPrefs();
  const unread = notif ? unreadCountOf(filterByPrefs(notif.view.items, notifPrefs)) : 0;
  // Don't scream "wrong network" while the connection is still settling (reconnect/hydration) — the
  // chainId isn't trustworthy yet. Only flag it once settled on a genuinely unsupported chain.
  const wrongNetwork = isConnected && !onSupportedChain && !networkSettling;

  return (
    <div className="topbar">
      <Link href="/chat" className="brand" style={{ cursor: "pointer" }}>
        <SparkMark size={23} />
        Sparky
      </Link>
      <PrimaryNav active={active} />
      <div className="grow" />
      <div className="rightcluster">
        <span className="stagePill"><StageBadge /></span>
        <span className="pill trustPill" title="What Sparky can & can't do" onClick={ov.openProveIt}>
          <span className="led" />
          Fully self-custodial
        </span>
        {/* STATUS, not a switcher — and ONE control, not three pills. It reports the chain the
            wallet is actually on, the connected wallet, and the optional NEAR claim. Testers change
            networks in their wallet; clicking the control opens the wallet menu (copy, explorer,
            permissions, disconnect). */}
        <div
          className="pill statusPill accountPill"
          data-testid="topbar-network-status"
          aria-live="polite"
          title={
            networkSettling
              ? "Checking which network your wallet is on…"
              : wrongNetwork
                ? "Your wallet is on a network this beta does not serve — switch it in your wallet."
                : "Network status and wallet. Change the network in your wallet."
          }
        >
          <button type="button" className="accountSeg" onClick={ov.openWalletMenu}>
            <NetworkLogo chainId={wrongNetwork ? undefined : chainId} color={network.color} size={16} />
            <span data-testid="topbar-network">
              {networkPillLabel({ networkSettling, wrongNetwork, networkName: network.name, nearAccountId })}
            </span>
          </button>
          <span className="accountDivider" aria-hidden />
          <button type="button" className="accountSeg accountAddr mono" onClick={ov.openWalletMenu}>
            {wallet}
          </button>
          <NearWalletControl inline />
          <button type="button" className="accountCaret" onClick={ov.openWalletMenu} aria-label="Wallet menu">
            <Icon name="chevd" size={12} />
          </button>
        </div>
        <button className="iconbtn only-desktop" title="Command (⌘K)" onClick={ov.openCommandPalette}>
          <Icon name="command" size={18} />
        </button>
        <button className="iconbtn" title="Notifications" onClick={ov.openNotifications}>
          <Icon name="bell" size={18} />
          {unread > 0 && <span className="count">{unread}</span>}
        </button>
        <button className="avatar-btn" onClick={ov.openAvatarMenu} aria-label="Account menu">
          SP
        </button>
      </div>
    </div>
  );
}
