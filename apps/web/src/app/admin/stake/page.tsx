"use client";

/**
 * Admin → Sparky — stakeholder overview (scStake). "Where we are. Aggregate,
 * plain-language, presentation-grade." The home screen for the Stakeholder and
 * Client "View as" roles. Faithful 1:1 port of the Stakeholder screen in
 * SparkPoint Admin.html.
 */

import { Icon } from "@/lib/icons";
import { STREAM, Composed, Trajectory, DivergeBars, DualArea } from "@/components/admin/charts";
import { data, Kpi } from "@/components/admin/data";

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>Sparky — stakeholder overview</h1>
          <div className="sub">Where we are. Aggregate, plain-language, presentation-grade.</div>
        </div>
        <span className="pill info" title="Illustrative sample data — not yet instrumented">
          <span className="led" /> Sample data
        </span>
        <button className="btn-exp">
          <Icon name="ext" size={13} /> Export PDF (audited)
        </button>
      </div>
      <div className="band">
        <Kpi label="TVL" val="$12.0M" spark={data.tvlSpark} sparkColor={STREAM.swap} delta="▲ 18% this month" deltaCls="up" />
        <Kpi label="Total users" val="3,240" spark={data.usersSpark} sparkColor={STREAM.premium} delta="▲ 22%" deltaCls="up" />
        <Kpi label="Cumulative revenue" val="$13.9K" spark={data.revSpark} sparkColor={STREAM.srk} delta="▲ since launch" deltaCls="up" />
        <Kpi label="Run-rate (ARR-eq.)" val="$82.8K" spark={data.mrrSpark} sparkColor={STREAM.premium} delta="▲ 23%" deltaCls="up" />
      </div>
      <div className="grid2">
        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Growth — money &amp; people</span>
            <span className="prov">90d</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: STREAM.swap }} />
              TVL
            </span>
            <span>
              <i style={{ background: STREAM.premium }} />
              Users
            </span>
          </div>
          <Composed
            areaV={[7.2, 8.0, 8.8, 9.6, 10.6, 11.4, 12.0]}
            lineV={[120, 260, 420, 560, 710, 820, 910]}
            amax={13}
            lmax={1000}
            opts={{ H: 230 }}
          />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Revenue trajectory</span>
            <span className="estbadge">forecast illustrative</span>
          </div>
          <Trajectory real={[1.6, 3.2, 5.1, 7.4, 10.3, 13.9]} fore={[13.9, 17.5, 21.6, 26.2, 31.4]} max={33} opts={{ H: 210 }} />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Net flows</span>
            <span className="prov">sample data</span>
          </div>
          <DivergeBars dep={[220, 310, 180, 420, 380, 260]} wd={[-90, -120, -60, -140, -110, -200]} opts={{ H: 210 }} />
        </div>
      </div>
      <div className="weeornot" style={{ marginBottom: 16 }}>
        <div className="ch" style={{ marginBottom: 6 }}>
          <span className="ct">We only earn when you earn</span>
        </div>
        <div className="legend">
          <span>
            <i style={{ background: STREAM.premium }} />
            User yield
          </span>
          <span>
            <i style={{ background: "var(--muted-foreground)" }} />
            Protocol revenue
          </span>
        </div>
        <DualArea yieldV={[20, 55, 110, 190, 290, 410]} revV={[1.6, 3.2, 5.1, 7.4, 10.3, 13.9]} max={430} opts={{ H: 190 }} />
      </div>
      <div className="trustbadges">
        <div className="tb">
          <Icon name="check" size={16} />
          <div>
            <div className="tbt">Non-custodial</div>
            <div className="tbs">Read-only over funds — no key custody</div>
          </div>
        </div>
        <div className="tb">
          <Icon name="check" size={16} />
          <div>
            <div className="tbt">Withdraw-always</div>
            <div className="tbs">On-chain self-service exit — always open</div>
          </div>
        </div>
        <div className="tb">
          <Icon name="check" size={16} />
          <div>
            <div className="tbt">0-fee conservative vault</div>
            <div className="tbs">0 on principal, 0 on yield</div>
          </div>
        </div>
        <div className="tb">
          <Icon name="check" size={16} />
          <div>
            <div className="tbt">Kill-switch</div>
            <div className="tbs">Multisig-governed · status shown</div>
          </div>
        </div>
      </div>
    </>
  );
}
