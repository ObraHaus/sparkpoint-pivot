"use client";

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { SECONDARY } from "@/lib/nav";

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
      <div style={{ flex: 1 }} />
      <Link href="/trust/exit" className="navlink exit">
        <Icon name="door" size={18} />
        Withdraw / Exit
      </Link>
    </aside>
  );
}
