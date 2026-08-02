"use client";

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { EXIT_ITEM, SECONDARY, toHref } from "@/lib/nav";
import { NavTree } from "./NavTree";
import { TipWidget } from "./TipWidget";

export function TrustRail({ active }: { active: string }) {
  return (
    <aside className="railnav">
      <div className="rail-label">Trust &amp; control</div>
      <NavTree
        nodes={SECONDARY}
        active={active}
        renderBadge={(route) => (route === "outcomes" ? <span className="badge-sm">3</span> : null)}
      />
      {/* Spacer pins the tip widget + exit to the bottom of the rail. The exit link is deliberately
          OUTSIDE the nav tree: it can never end up inside a collapsed group (N2). */}
      <div style={{ flex: 1 }} />
      <TipWidget />
      <Link href={toHref(EXIT_ITEM.route)} className="navlink exit">
        <Icon name={EXIT_ITEM.icon} size={18} />
        {EXIT_ITEM.label}
      </Link>
    </aside>
  );
}
