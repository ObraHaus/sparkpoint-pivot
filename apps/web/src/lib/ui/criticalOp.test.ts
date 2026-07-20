import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginCriticalOp,
  getCriticalSnapshot,
  isBusy,
  isLocked,
  subscribeCriticalOp,
  __resetCriticalOp,
} from "./criticalOp.ts";

test("beginCriticalOp counts and releases; isLocked/isBusy reflect the counters", () => {
  __resetCriticalOp();
  assert.equal(isLocked(), false);
  const r1 = beginCriticalOp("locked");
  const r2 = beginCriticalOp("locked");
  assert.equal(isLocked(), true);
  r1();
  assert.equal(isLocked(), true, "still locked with one hold remaining");
  r2();
  assert.equal(isLocked(), false, "released when the last hold clears");

  const b = beginCriticalOp("busy");
  assert.equal(isBusy(), true);
  assert.equal(isLocked(), false);
  b();
  assert.equal(isBusy(), false);
});

test("release is idempotent (double-release cannot drive the counter negative)", () => {
  __resetCriticalOp();
  const r = beginCriticalOp("locked");
  r();
  r();
  r();
  assert.equal(isLocked(), false);
  const r2 = beginCriticalOp("locked");
  assert.equal(isLocked(), true, "a prior over-release did not corrupt the counter");
  r2();
  assert.equal(isLocked(), false);
});

test("snapshot reference is stable between changes and new only on a boolean flip", () => {
  __resetCriticalOp();
  const s0 = getCriticalSnapshot();
  const r1 = beginCriticalOp("locked"); // false→true : new snapshot
  const s1 = getCriticalSnapshot();
  assert.notEqual(s0, s1);
  assert.deepEqual(s1, { locked: true, busy: false });
  const r2 = beginCriticalOp("locked"); // 1→2 : no boolean change : same ref
  assert.equal(getCriticalSnapshot(), s1);
  r2(); // 2→1 : still locked : same ref
  assert.equal(getCriticalSnapshot(), s1);
  r1(); // 1→0 : true→false : new snapshot
  assert.notEqual(getCriticalSnapshot(), s1);
});

test("subscribers fire only on a boolean transition", () => {
  __resetCriticalOp();
  let n = 0;
  const unsub = subscribeCriticalOp(() => {
    n += 1;
  });
  const r1 = beginCriticalOp("busy"); // fire
  const r2 = beginCriticalOp("busy"); // no fire (count 1→2)
  r2(); // no fire (2→1)
  r1(); // fire (1→0)
  assert.equal(n, 2);
  unsub();
});
