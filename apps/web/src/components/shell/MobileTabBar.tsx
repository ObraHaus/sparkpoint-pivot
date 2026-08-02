"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/lib/icons";
import {
  containsRoute,
  EXIT_ITEM,
  NOTIFICATIONS_ITEM,
  PERMISSIONS_ITEM,
  PRIMARY,
  SECONDARY,
  toHref,
} from "@/lib/nav";
import { NavTree } from "./NavTree";

export function MobileTabBar({ active }: { active: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Group children count too — being inside a collapsed group must not lose the "More" active state.
  const moreActive = containsRoute(SECONDARY, active);
  const close = () => setMoreOpen(false);

  return (
    <>
      <nav className="tabbar">
        {PRIMARY.map((n) => (
          <Link key={n.route} href={toHref(n.route)} className={active === n.route ? "active" : ""}>
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
          <div className="scrim show" onClick={close} />
          <div className="sheet show" role="dialog" aria-label="More">
            <div className="sheet-hd">
              <span className="t">More</span>
              <button className="iconbtn" onClick={close} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="sheet-bd">
              {/* Pinned above the fold, outside the tree — same two escape hatches as today (N2). */}
              <Link href={toHref(EXIT_ITEM.route)} className="navlink exit" style={{ marginBottom: 12 }} onClick={close}>
                <Icon name={EXIT_ITEM.icon} size={18} />
                {EXIT_ITEM.label}
              </Link>
              <Link href={toHref(PERMISSIONS_ITEM.route)} className="navlink" onClick={close}>
                <Icon name={PERMISSIONS_ITEM.icon} size={18} />
                {PERMISSIONS_ITEM.label}
              </Link>
              <div className="divider" />
              <NavTree nodes={SECONDARY} active={active} onNavigate={close} />
              <Link href={toHref(NOTIFICATIONS_ITEM.route)} className="navlink" onClick={close}>
                <Icon name={NOTIFICATIONS_ITEM.icon} size={18} />
                {NOTIFICATIONS_ITEM.label}
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}
