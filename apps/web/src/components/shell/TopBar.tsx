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

export function TopBar({ active }: { active: string }) {
  const { network, wallet, isConnected, onSupportedChain, chainId, networkSettling } = useNetwork();
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
        <span
          className="pill netPill"
          title={networkSettling ? "Checking network…" : wrongNetwork ? "Switch to a supported network" : "Switch network"}
          onClick={ov.openNetworkMenu}
        >
          <NetworkLogo chainId={wrongNetwork ? undefined : chainId} color={network.color} size={16} />
          <span>{networkSettling ? "Checking…" : wrongNetwork ? "Switch network" : network.name}</span>
          <Icon name="chevd" size={12} />
        </span>
        <span className="pill walletPill" onClick={ov.openWalletMenu}>
          <span className="mono">{wallet}</span>
          <Icon name="chevd" size={12} />
        </span>
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
