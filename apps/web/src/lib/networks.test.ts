import test from "node:test";
import assert from "node:assert/strict";

import { CHAIN_IDS } from "@sparkpoint/shared/chains";
import {
  NETWORKS,
  PUBLIC_NETWORKS,
  connectableNetworks,
  destinationNetworks,
  networkLabel,
  networkNames,
} from "@sparkpoint/shared/networks";

test("the public story names every network the brief promises, once", () => {
  const labels = PUBLIC_NETWORKS.map((n) => n.label);
  for (const expected of ["Base", "Ethereum", "Solana", "NEAR", "Bitcoin", "Robinhood Chain"]) {
    assert.ok(labels.includes(expected), `missing ${expected}`);
  }
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(networkNames(), labels.join(" · "));
});

test("EVM ids in the multi-network registry agree with the EVM chain registry", () => {
  const byId = new Map(NETWORKS.filter((n) => n.chainId !== undefined).map((n) => [n.id, n.chainId]));
  assert.equal(byId.get("base"), CHAIN_IDS.base);
  assert.equal(byId.get("robinhood"), CHAIN_IDS.robinhoodMainnet);
  assert.equal(byId.get("baseSepolia"), CHAIN_IDS.baseSepolia);
});

test("Bitcoin is destination-only; NEAR and Base can receive and connect", () => {
  const btc = NETWORKS.find((n) => n.id === "bitcoin");
  assert.equal(btc?.destinationOnly, true);
  assert.equal(btc?.capabilities.receiveDestination, true);
  assert.equal(btc?.capabilities.connect, false);
  assert.equal(btc?.capabilities.sendFromWallet, false);
  assert.deepEqual(
    connectableNetworks().map((n) => n.id),
    ["base", "near", "robinhood"],
  );
  assert.ok(destinationNetworks().some((n) => n.id === "solana"));
  assert.equal(networkLabel("solana"), "Solana");
  assert.equal(networkLabel("unknown-chain"), "unknown-chain");
});
