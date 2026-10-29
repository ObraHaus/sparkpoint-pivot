"use client";

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import { useLocalState } from "@/lib/ui/useLocalState";

/** localStorage key for the dismissed trust banner (per device, survives reloads). */
export const TRUST_BANNER_DISMISSED_KEY = "sp.trust-banner.dismissed.v1";

export function DisclaimerStrip() {
  const ov = useOverlay();
  const [dismissed, setDismissed] = useLocalState<boolean>(TRUST_BANNER_DISMISSED_KEY, false);
  if (dismissed) return null;
  return (
    <div className="disclaimer" data-testid="trust-banner">
      <span className="di">
        <Icon name="info" size={15} />
      </span>
      <span className="txt">
        <b>The AI proposes. Guardrails check it. You sign it.</b> Not financial advice · capital at risk · Sparky can never
        move your funds.
      </span>
      <span className="links">
        <a onClick={ov.openProveIt}>Prove it</a>
        <Link href="/fees">How we make money</Link>
        <Link href="/trust/exit">Exit anytime</Link>
      </span>
      <button
        className="dismiss"
        aria-label="Dismiss trust banner"
        title="Dismiss — you can reopen the Trust Center any time"
        onClick={() => setDismissed(true)}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
