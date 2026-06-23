"use client";

/**
 * Admin → Config (scCfg). "Non-custodial operational config. Controls app access,
 * never funds." Faithful 1:1 port of the Config screen in SparkPoint Admin.html.
 */

import { Icon } from "@/lib/icons";

const FLAGS = ["Chat assistant", "AI swap (Aerodrome)", "Premium tier", "Session-key automation", "Performance fee · 10% over HWM"];

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>Config</h1>
          <div className="sub">Non-custodial operational config. Controls app access, never funds.</div>
        </div>
      </div>
      <div className="infobanner">
        <Icon name="info" size={16} />
        <span>
          These settings control app access and features. <b style={{ color: "var(--foreground)" }}>They cannot move funds or block
          withdrawals.</b> Every change is confirmed, audited, and routed through the governed path.
        </span>
      </div>
      <div className="panel">
        <div className="ch" style={{ marginBottom: 10 }}>
          <span className="ct">Feature flags</span>
        </div>
        {FLAGS.map((f, i) => (
          <div className="statusrow" key={f}>
            <span>{f}</span>
            <span className={`pill ${i < 5 ? "ok" : "info"}`}>
              <span className="led" />
              {i < 5 ? "On" : "Preview"}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
