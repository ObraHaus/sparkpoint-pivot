/**
 * /srk — SRK: a non-essential utility token. Informational only; never gates the product.
 *
 * Faithful 1:1 port of the design's `srk` screen
 * (docs/design-handover/showcase/screens/support.js). Markup, classes, and copy verbatim.
 */

import { Icon } from "@/lib/icons";
import "@/components/screens/support.css";

export default function Page() {
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>SRK</h1>
          <div className="sub">A non-essential utility token. Nothing core depends on it.</div>
        </div>
      </div>
      <div className="card card-pad" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <span
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: "var(--spark-subtle)",
            color: "var(--primary)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name="coins" size={22} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Your balance</div>
          <div style={{ fontSize: 22, fontWeight: 600 }} className="tnum">
            0 SRK
          </div>
        </div>
        <button className="btn btn-outline btn-md">How to earn</button>
      </div>
      <div
        className="card card-pad"
        style={{
          background: "var(--info-subtle)",
          borderColor: "color-mix(in srgb,var(--info) 22%,transparent)",
          display: "flex",
          gap: 10,
        }}
      >
        <Icon name="info" size={16} />
        <span style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
          SRK never gates the vault, onboarding, or chat. The product works fully without it — this surface is
          informational only.
        </span>
      </div>
    </div>
  );
}
