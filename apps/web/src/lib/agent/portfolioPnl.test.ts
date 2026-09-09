import { test } from "node:test";
import assert from "node:assert/strict";
import { toPortfolioPnl } from "./portfolioPnl.ts";

test("maps realized/unrealized + per-position realizedPnlUsd; null → undefined", () => {
  const v = toPortfolioPnl(
    { series: [], realizedUsd: "10.00", unrealizedUsd: "-4.50" },
    [{ positionId: "vault", costBasisUsd: "50.00", unrealizedPnlUsd: "-4.50", realizedPnlUsd: "10.00" }],
  );
  assert.equal(v.realizedUsd, 10);
  assert.equal(v.unrealizedUsd, -4.5);
  assert.equal(v.positionPnl["vault"].realizedPnlUsd, 10);
  assert.equal(v.positionPnl["vault"].costBasisUsd, 50);
});

test("null wire figures map to undefined (pending), never 0", () => {
  const v = toPortfolioPnl(
    { series: [], realizedUsd: null, unrealizedUsd: null },
    [{ positionId: "vault", costBasisUsd: null, realizedPnlUsd: null }],
  );
  assert.equal(v.realizedUsd, undefined);
  assert.equal(v.unrealizedUsd, undefined);
  assert.equal(v.positionPnl["vault"].realizedPnlUsd, undefined);
  assert.equal(v.positionPnl["vault"].costBasisUsd, undefined);
});

test("series needs ≥2 points; pnl abs/pct derived from the endpoints", () => {
  const v = toPortfolioPnl(
    { series: [{ ts: "2026-07-01T00:00:00Z", valueUsd: "100" }, { ts: "2026-07-02T00:00:00Z", valueUsd: "110" }] },
    [],
  );
  assert.deepEqual(v.series, [100, 110]);
  assert.deepEqual(v.pnl, { abs: 10, pct: 10 });
});

test("a single-point series yields no series/pnl but a 1-point history", () => {
  const v = toPortfolioPnl({ series: [{ ts: "2026-07-01T00:00:00Z", valueUsd: "100" }] }, []);
  assert.equal(v.series, undefined);
  assert.equal(v.pnl, undefined);
  assert.equal(v.history.length, 1);
});

test("history filters unparseable timestamps + missing values", () => {
  const v = toPortfolioPnl(
    {
      series: [
        { ts: "nope", valueUsd: "100" },
        { ts: "2026-07-02T00:00:00Z", valueUsd: "110" },
        { ts: "2026-07-03T00:00:00Z" },
      ],
    },
    [],
  );
  assert.equal(v.history.length, 1);
  assert.equal(v.history[0].v, 110);
});
