"use client";

import Link from "next/link";
import { Icon, SparkMark } from "@/lib/icons";
import { useNetwork } from "@/lib/network";
import { data } from "@/lib/mock-data";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import { PrimaryNav } from "@/components/shell/PrimaryNav";

export function TopBar({ active }: { active: string }) {
  const { network, wallet } = useNetwork();
  const ov = useOverlay();
  const unread = data.notifications.filter((n) => n.unread).length;

  return (
    <div className="topbar">
      <Link href="/chat" className="brand" style={{ cursor: "pointer" }}>
        <SparkMark size={23} />
        Sparky
      </Link>
      <PrimaryNav active={active} />
      <div className="grow" />
      <div className="rightcluster">
        <span className="pill" title="What Sparky can & can't do" onClick={ov.openProveIt}>
          <span className="led" />
          Fully self-custodial
        </span>
        <span className="pill netPill" title="Switch network" onClick={ov.openNetworkMenu}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: network.color, flex: "none" }} />
          <span>{network.name}</span>
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
