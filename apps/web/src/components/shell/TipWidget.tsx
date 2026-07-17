"use client";

/**
 * TipWidget — the compact card at the bottom of the left rail (above the Changelog button).
 *
 * Priority: an active ANNOUNCEMENT (admin-set) is pinned first; its dismissal is keyed to the
 * announcement id, so a NEW announcement re-surfaces after a prior dismiss. Otherwise it rotates
 * TIPS from the Obsidian 'tip' databank (paged "1 / N · Next", dismissable for the session).
 *
 * Reads go through the beta-gated BFF; when offline (no wallet) both hooks return empty and the
 * widget renders nothing. A CTA is only ever an internal path or an https link (server-validated).
 */

import { useState } from "react";
import Link from "next/link";

import { Icon } from "@/lib/icons";
import { useAnnouncement, useTips } from "@/lib/agent/useContent";
import { useLocalState } from "@/lib/ui/useLocalState";

function CtaLink({ label, href }: { label: string; href: string }) {
  if (href.startsWith("https://")) {
    return (
      <a className="tipcard-cta" href={href} target="_blank" rel="noopener noreferrer">
        {label} <Icon name="ext" size={11} />
      </a>
    );
  }
  return (
    <Link className="tipcard-cta" href={href}>
      {label} <Icon name="chevr" size={12} />
    </Link>
  );
}

export function TipWidget() {
  const announcement = useAnnouncement();
  const tips = useTips();
  const [dismissedId, setDismissedId] = useLocalState<number | null>("sp-tip-ann", null);
  const [tipIdx, setTipIdx] = useState(0);
  const [tipsHidden, setTipsHidden] = useState(false);

  // Announcement takes priority (pinned). Keyed dismissal → a NEW announcement re-surfaces.
  if (announcement && announcement.id !== dismissedId) {
    return (
      <div className="tipcard tipcard-ann">
        <div className="tipcard-hd">
          <span className="tipcard-eyebrow">
            <Icon name="bell" size={12} /> Announcement
          </span>
          <button
            className="tipcard-x"
            type="button"
            aria-label="Dismiss announcement"
            onClick={() => setDismissedId(announcement.id)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="tipcard-title">{announcement.title}</div>
        <div className="tipcard-body">{announcement.body}</div>
        {announcement.ctaLabel && announcement.ctaHref && (
          <CtaLink label={announcement.ctaLabel} href={announcement.ctaHref} />
        )}
      </div>
    );
  }

  if (tipsHidden || tips.length === 0) return null;
  const idx = tipIdx % tips.length;
  const tip = tips[idx];

  return (
    <div className="tipcard">
      <div className="tipcard-hd">
        <span className="tipcard-eyebrow">
          <Icon name="info" size={12} /> Tip
        </span>
        <button
          className="tipcard-x"
          type="button"
          aria-label="Dismiss tip"
          onClick={() => setTipsHidden(true)}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="tipcard-title">{tip.title}</div>
      <div className="tipcard-body">{tip.body}</div>
      {tip.ctaLabel && tip.ctaHref && <CtaLink label={tip.ctaLabel} href={tip.ctaHref} />}
      <div className="tipcard-ft">
        <span className="tipcard-count">
          {idx + 1} / {tips.length}
        </span>
        {tips.length > 1 && (
          <button className="tipcard-next" type="button" onClick={() => setTipIdx((i) => i + 1)}>
            Next <Icon name="chevr" size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
