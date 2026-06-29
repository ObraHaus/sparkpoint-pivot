"use client";

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { useOverlay } from "@/components/overlays/OverlayProvider";

export function DisclaimerStrip() {
  const ov = useOverlay();
  return (
    <div className="disclaimer">
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
    </div>
  );
}
