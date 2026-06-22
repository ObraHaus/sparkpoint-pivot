/**
 * /portfolio/[positionId] — position detail (the design's `portfolio/vault` screen).
 *
 * Faithful 1:1 port of docs/design-handover/showcase/screens/portfolio.js
 * (the `portfolio/vault` registered screen): shares / value / accrued-yield stats,
 * the transactions table, and add-to-position / withdraw actions.
 *
 * Next 16: `params` is a Promise — unwrapped with `await`.
 */

import Link from "next/link";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import "@/components/screens/portfolio.css";

export default async function Page({ params }: { params: Promise<{ positionId: string }> }) {
  const { positionId } = await params;
  void positionId; // single sample position in this build (the Aave Yield Vault)

  return (
    <div className="page page-narrow">
      <Link className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} href={toHref("portfolio")}>
        <Icon name="chevr" size={15} /> Back to portfolio
      </Link>
      <div className="pagehead">
        <div>
          <h1>Aave Yield Vault</h1>
          <div className="sub">Your position detail</div>
        </div>
        <RiskChip tier={1} />
      </div>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="posstats">
          <div className="stat">
            <span className="k">Shares</span>
            <span className="v tnum">9,834.5031</span>
            <span className="muted" style={{ fontSize: 11 }}>
              spvUSDC
            </span>
          </div>
          <div className="stat">
            <span className="k">Value</span>
            <span className="v tnum">{money(data.vault.shareValue)}</span>
          </div>
          <div className="stat">
            <span className="k">Accrued yield</span>
            <span className="v tnum" style={{ color: "var(--gain)" }}>
              +{money(data.vault.accrued)}
            </span>
          </div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">Transactions</span>
        </div>
        <table className="tbl">
          <tbody>
            {data.txs.map((t, i) => (
              <tr key={i}>
                <td>
                  <div style={{ fontWeight: 600 }}>{t.type}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {t.time}
                  </div>
                </td>
                <td className="num tnum" style={{ color: t.dir === "in" ? "var(--gain)" : "var(--foreground)" }}>
                  {t.amt}
                </td>
                <td className="num muted tnum">{t.usd}</td>
                <td>
                  <a className="cite" style={{ cursor: "pointer" }}>
                    tx <Icon name="ext" size={10} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <Link className="btn btn-primary btn-md" href={toHref("vault/deposit")}>
          Add to position
        </Link>
        <Link className="btn btn-outline btn-md" href={toHref("vault/withdraw")}>
          Withdraw
        </Link>
      </div>
    </div>
  );
}
