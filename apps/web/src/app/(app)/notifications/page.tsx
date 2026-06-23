/**
 * /notifications — Transaction results and important alerts (from data.notifications).
 *
 * Faithful 1:1 port of the design's `notifications` screen
 * (docs/design-handover/showcase/screens/support.js). Markup, classes, and copy verbatim.
 */

import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import "@/components/screens/support.css";

export default function Page() {
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>Notifications</h1>
          <div className="sub">Transaction results and important alerts.</div>
        </div>
      </div>
      <div className="card card-pad">
        {data.notifications.map((n, i) => (
          <div className="setrow" key={i}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: "var(--spark-subtle)",
                  color: "var(--primary)",
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                }}
              >
                <Icon name={n.icon} size={16} />
              </span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.t}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{n.s}</div>
              </div>
            </div>
            <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{n.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
