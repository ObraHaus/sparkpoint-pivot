"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/lib/icons";
import { PRIMARY, SECONDARY } from "@/lib/nav";

export function MobileTabBar({ active }: { active: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = SECONDARY.some((s) => s.route === active);

  const moreLinks = [...SECONDARY, { route: "notifications", label: "Notifications", icon: "bell" as const }];

  return (
    <>
      <nav className="tabbar">
        {PRIMARY.map((n) => (
          <Link key={n.route} href={"/" + n.route} className={active === n.route ? "active" : ""}>
            <Icon name={n.icon} size={21} />
            <span>{n.label}</span>
          </Link>
        ))}
        <a className={moreActive ? "active" : ""} onClick={() => setMoreOpen(true)}>
          <Icon name="grid" size={21} />
          <span>More</span>
        </a>
      </nav>

      {moreOpen && (
        <>
          <div className="scrim show" onClick={() => setMoreOpen(false)} />
          <div className="sheet show" role="dialog" aria-label="More">
            <div className="sheet-hd">
              <span className="t">More</span>
              <button className="iconbtn" onClick={() => setMoreOpen(false)} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="sheet-bd">
              <Link href="/trust/exit" className="navlink exit" style={{ marginBottom: 12 }} onClick={() => setMoreOpen(false)}>
                <Icon name="door" size={18} />
                Withdraw / Exit
              </Link>
              <Link href="/trust/permissions" className="navlink" onClick={() => setMoreOpen(false)}>
                <Icon name="shieldcheck" size={18} />
                Prove it — permissions
              </Link>
              <Link href="/changelog" className="navlink" onClick={() => setMoreOpen(false)}>
                <Icon name="book" size={18} />
                Changelog
              </Link>
              <div className="divider" />
              {moreLinks.map((n) => (
                <Link key={n.route} href={"/" + n.route} className="navlink" onClick={() => setMoreOpen(false)}>
                  <Icon name={n.icon} size={18} />
                  {n.label}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
