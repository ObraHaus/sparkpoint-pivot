"use client";

/**
 * /premium/pay — Upgrade to Premium: a subscription payment in SRK (not a vault fee).
 * Shows the plan, price, SRK balance, and either an acquire-SRK hand-off (when the
 * balance is below the price) or a review-&-sign path. Premium never gates the vault.
 *
 * Faithful 1:1 port of the design's `premium/pay` screen
 * (docs/design-handover/showcase/screens/premium.js). Markup, classes, and copy verbatim.
 */

import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import "@/components/screens/premium.css";

export default function Page() {
  const router = useRouter();
  const { toast } = useOverlay();

  const balance = 320,
    price = 500,
    low = balance < price;

  return (
    <div className="page page-narrow">
      <a
        className="qlink"
        style={{ display: "inline-flex", marginBottom: 14, cursor: "pointer" }}
        onClick={() => router.push(toHref("premium"))}
      >
        <Icon name="chevr" size={15} /> Back
      </a>
      <div className="pagehead">
        <div>
          <h1>Upgrade to Premium</h1>
          <div className="sub">A subscription payment in SRK — not a vault fee. Cancel anytime.</div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="payrow">
          <span className="muted">Plan</span>
          <span style={{ fontWeight: 600 }}>Premium · monthly</span>
        </div>
        <div className="payrow">
          <span className="muted">Price</span>
          <span className="tnum">
            500 SRK <span className="muted">≈ $12.00</span>
          </span>
        </div>
        <div className="payrow">
          <span className="muted">Your SRK balance</span>
          <span className="tnum" style={{ color: low ? "var(--caution)" : "var(--foreground)" }}>
            {balance} SRK
          </span>
        </div>
        <div className="payrow">
          <span className="muted">Sparky fee</span>
          <span>n/a — subscription payment, not a vault fee</span>
        </div>
      </div>
      {low ? (
        <>
          <div
            className="pm-banner"
            style={{
              marginTop: 16,
              background: "var(--caution-subtle)",
              borderColor: "color-mix(in srgb,var(--caution) 26%,transparent)",
            }}
          >
            <Icon name="alert" size={16} />
            <span>
              You need <b>{price - balance} more SRK</b> to pay for the first month. You can acquire SRK, or this never
              blocks any free feature.
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              className="btn btn-outline btn-lg"
              style={{ flex: "none" }}
              onClick={() => toast("Opens acquire-SRK hand-off")}
            >
              Acquire SRK
            </button>
            <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled>
              Review &amp; sign
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", margin: "14px 0" }}>
            You&apos;ll sign an <b style={{ color: "var(--foreground)" }}>approve</b> +{" "}
            <b style={{ color: "var(--foreground)" }}>pay</b> transaction — non-custodial, through the same sign gate as
            everything else.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn btn-outline btn-lg"
              style={{ flex: "none" }}
              onClick={() => router.push(toHref("premium"))}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-lg"
              style={{ flex: 1 }}
              onClick={() => router.push(toHref("confirm/premium"))}
            >
              Review &amp; sign
            </button>
          </div>
        </>
      )}
      <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>
        Premium never gates the vault, deposits, yield, or withdrawals.
      </div>
    </div>
  );
}
