"use client";

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { SECONDARY } from "@/lib/nav";
import { TipWidget } from "./TipWidget";

export function TrustRail({ active }: { active: string }) {
  return (
    <aside className="railnav">
      <div className="rail-label">Trust &amp; control</div>
      {SECONDARY.map((n) => (
        <Link key={n.route} href={"/" + n.route} className={"navlink" + (active === n.route ? " active" : "")}>
          <Icon name={n.icon} size={18} />
          {n.label}
          {n.route === "outcomes" && <span className="badge-sm">3</span>}
        </Link>
      ))}
      {/* Spacer pins the tip widget + changelog + exit to the bottom of the rail. */}
      <div style={{ flex: 1 }} />
      <TipWidget />
      <Link href="/changelog" className={"navlink" + (active === "changelog" ? " active" : "")}>
        <Icon name="book" size={18} />
        Changelog
      </Link>
      <Link href="/trust/exit" className="navlink exit">
        <Icon name="door" size={18} />
        Withdraw / Exit
      </Link>
    </aside>
  );
}
