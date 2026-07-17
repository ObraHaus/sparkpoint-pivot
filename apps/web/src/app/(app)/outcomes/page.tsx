/**
 * /outcomes — Outcome Log: every move you acted on, wins and losses, tied to the
 * recommendation that caused it, each labeled with its realized PnL (from data.outcomes).
 *
 * Faithful 1:1 port of the design's `outcomes` screen
 * (docs/design-handover/showcase/screens/support.js). Markup, classes, and copy verbatim.
 */

import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import "@/components/screens/support.css";
import { StatusTag } from "@/components/ui/status-tag";

export default function Page() {
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 10 }}>Outcome Log <StatusTag variant="mock" title={"Preview — the on-chain outcome/event index isn’t built yet."} /></h1>
          <div className="sub">Every move you acted on — wins and losses — tied to the advice that caused it.</div>
        </div>
      </div>
      <div className="card card-pad">
        <div style={{ display: "flex", gap: 18, marginBottom: 18 }}>
          <div className="stat">
            <span className="k">Net realized</span>
            <span className="v tnum" style={{ color: "var(--gain)" }}>
              −$27.86
            </span>
          </div>
          <div className="stat">
            <span className="k">Wins</span>
            <span className="v tnum">2</span>
          </div>
          <div className="stat">
            <span className="k">Losses</span>
            <span className="v tnum">1</span>
          </div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>From the recommendation</th>
              <th className="num">Realized PnL</th>
              <th className="num">Proof</th>
            </tr>
          </thead>
          <tbody>
            {data.outcomes.map((o) => (
              <tr key={o.id} style={{ cursor: "pointer" }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{o.from.replace("the ", "").replace(" recommendation", "")}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {o.cause}
                  </div>
                </td>
                <td className="num">
                  <span className={"delta " + (o.kind === "gain" ? "up" : "down")} style={{ fontSize: 13 }}>
                    <Icon name={o.kind === "gain" ? "up" : "down"} size={13} />
                    {o.pnl} ({o.pct}, {o.win})
                  </span>
                </td>
                <td className="num">
                  <a className="cite" style={{ cursor: "pointer" }}>
                    tx <Icon name="ext" size={10} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 14, textAlign: "center" }}>
        We show losses as plainly as gains — no flattering windows, no euphemism.
      </div>
    </div>
  );
}
