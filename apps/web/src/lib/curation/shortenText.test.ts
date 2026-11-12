import assert from "node:assert/strict";
import { test } from "node:test";

import { shortenAddressesInText } from "./model.ts";
import { collectFilterValues, filterVaults } from "../vault/vaultList.ts";

test("shortenAddressesInText shortens full EVM addresses in display text", () => {
  assert.equal(
    shortenAddressesInText("$540.3M TVL, 0x9023fbd6a08c666491a2d1648737e400cf42d2fb."),
    "$540.3M TVL, 0x9023…d2fb.",
  );
  assert.equal(shortenAddressesInText("Gauntlet"), "Gauntlet");
});

test("Morpho source variants share one protocol filter", () => {
  const items = [
    { chain: "base", protocol: "morpho", live: true },
    { chain: "robinhood", protocol: "morpho-api+onchain", live: false },
    { chain: "near", protocol: "rhea", live: true },
  ];
  assert.deepEqual(collectFilterValues(items, "protocol"), ["morpho", "rhea"]);
  assert.equal(filterVaults(items, { chain: "all", protocol: "morpho" }).length, 2);
});
