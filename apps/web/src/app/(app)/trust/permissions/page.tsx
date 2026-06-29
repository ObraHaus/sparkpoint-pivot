"use client";

/**
 * /trust/permissions — "What Sparky can & can't do": the exact on-chain
 * permissions, read live from the contracts via Base RPC.
 *
 * Faithful 1:1 port of the design's `trust/permissions` screen
 * (docs/design-handover/showcase/screens/trust.js). The can/can't columns and the
 * granted-permissions table (incl. the admin.withdraw() "no code path" trust payload)
 * are reproduced verbatim.
 */

import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import "@/components/screens/trust.css";

export default function Page() {
  const router = useRouter();
  const { toast } = useOverlay();

  return (
    <div className="page page-narrow">
      <a
        className="qlink"
        style={{ display: "inline-flex", marginBottom: 14 }}
        onClick={() => router.push(toHref("trust"))}
      >
        <Icon name="chevr" size={15} /> Back to Trust Center
      </a>
      <div className="pagehead">
        <div>
          <h1>What Sparky can &amp; can&apos;t do</h1>
          <div className="sub">Read live from the contracts via Base RPC — works even if our backend is down.</div>
        </div>
      </div>
      <div className="cancan" style={{ marginBottom: 18 }}>
        <div className="col can">
          <h5>Can</h5>
          <ul>
            <li>
              <Icon name="check" size={13} />
              Direct strategy
            </li>
            <li>
              <Icon name="check" size={13} />
              Suggest moves
            </li>
            <li>
              <Icon name="check" size={13} />
              Simulate
            </li>
            <li>
              <Icon name="check" size={13} />
              Pause new deposits
            </li>
          </ul>
        </div>
        <div className="col cant">
          <h5>Can&apos;t</h5>
          <ul>
            <li>
              <Icon name="x" size={13} />
              Move your funds
            </li>
            <li>
              <Icon name="x" size={13} />
              Withdraw to itself
            </li>
            <li>
              <Icon name="x" size={13} />
              Change the rules
            </li>
            <li>
              <Icon name="x" size={13} />
              Stop you withdrawing
            </li>
          </ul>
        </div>
      </div>
      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">Granted on-chain permissions</span>
          <span className="lbl">live</span>
        </div>
        <table className="tbl permtable">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Grantee</th>
              <th className="num">Limit</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>vault.rebalance()</td>
              <td>0x3a…77B (policy)</td>
              <td className="num">allowlist only</td>
            </tr>
            <tr>
              <td>maxSlippage</td>
              <td>policy module</td>
              <td className="num">0.50%</td>
            </tr>
            <tr>
              <td>perTxCap</td>
              <td>policy module</td>
              <td className="num">$25,000</td>
            </tr>
            <tr>
              <td>admin.withdraw()</td>
              <td style={{ color: "var(--loss)" }}>— none —</td>
              <td className="num" style={{ color: "var(--loss)" }}>
                no code path
              </td>
            </tr>
            <tr>
              <td>user.withdraw()</td>
              <td style={{ color: "var(--gain)" }}>you only</td>
              <td className="num" style={{ color: "var(--gain)" }}>
                unlimited
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 14, lineHeight: 1.5 }}>
          The <span className="mono">admin.withdraw()</span> row is the trust payload: there is no function by which
          Sparky can move your funds.
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="btn btn-outline btn-md" onClick={() => toast("Opens Basescan ↗")}>
          <Icon name="ext" size={16} /> Verify on Basescan
        </button>
        <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("trust/exit"))}>
          Withdraw now
        </button>
      </div>
    </div>
  );
}
