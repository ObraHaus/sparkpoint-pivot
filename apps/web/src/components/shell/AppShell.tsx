"use client";

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { baseSegment } from "@/lib/nav";
import { TopBar } from "@/components/shell/TopBar";
import { DisclaimerStrip } from "@/components/shell/DisclaimerStrip";
import { TrustRail } from "@/components/shell/TrustRail";
import { MobileTabBar } from "@/components/shell/MobileTabBar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = baseSegment(pathname);

  return (
    <div className="appshell">
      <TopBar active={active} />
      <DisclaimerStrip />
      <div className="layout">
        <TrustRail active={active} />
        <main className="main">{children}</main>
      </div>
      <MobileTabBar active={active} />
    </div>
  );
}
