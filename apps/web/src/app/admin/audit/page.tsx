"use client";

/**
 * Admin → Admin audit log (scAudit). "Append-only record of every admin action.
 * Viewing this is itself logged." Faithful 1:1 port of the Audit screen in
 * SparkPoint Admin.html. Read-only forensics — no fund-moving controls.
 */

const ROWS: [string, string, string, string, string][] = [
  ["09:41", "admin_a", "view_dashboard", "revenue", "ok"],
  ["09:38", "admin_a", "stepup_pass", "—", "ok"],
  ["08:12", "admin_b", "export_csv", "revenue_history", "ok"],
  ["07:50", "admin_c", "view_user_detail", "user_8f2a", "ok"],
  ["02:14", "admin_x", "login", "—", "denied"],
];

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>Admin audit log</h1>
          <div className="sub">Append-only record of every admin action. Viewing this is itself logged.</div>
        </div>
      </div>
      <div className="panel">
        <table className="adtbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Subject</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r[0]}>
                <td className="mono">{r[0]}</td>
                <td className="mono">{r[1]}</td>
                <td>{r[2]}</td>
                <td className="mono">{r[3]}</td>
                <td>
                  <span className={`pill ${r[4] === "ok" ? "ok" : "amber"}`}>{r[4]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
