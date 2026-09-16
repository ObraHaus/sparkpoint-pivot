import { zeroAddress } from "viem";
import { engineAbi } from "./shared/abis.ts";
import { beat } from "./shared/health.ts";
import {
  accountOf,
  assertChain,
  chain,
  optionalNumber,
  publicClient,
  redact,
  required,
  rpcUrl,
  walletFor,
  warnIfLowOnGas,
} from "./shared/chain.ts";
import { loadDeployment } from "./shared/deployments.ts";
import { forever, logger } from "./shared/log.ts";

/**
 * The keeper: `settle()` at each round boundary, then `sync` and batched `deliver`.
 *
 * **Both calls are permissionless.** Nothing here holds a privilege — this process needs an address
 * with gas and nothing else, and any holder can perform every call it makes. That is what makes
 * running it acceptable rather than a centralisation: if it stops, credit keeps accruing in the
 * engine's `accPerWeight` and a restart collects everything owed. Delivery is **late, not missing**.
 *
 * ⚠️ Never read `block.number`. On Robinhood Chain the height a contract sees and the height the RPC
 * serves are ~89 million apart, and looking one up *succeeds* and returns an unrelated block. Every
 * round boundary here keys on `block.timestamp`, through the engine's own `currentRound()`.
 */
const log = logger("keeper");

async function main(): Promise<void> {
  await assertChain();

  const book = loadDeployment();
  const wallet = walletFor(required("KEEPER_PRIVATE_KEY"));
  const from = accountOf(wallet);
  const client = publicClient();
  const engine = book.contracts.engine;

  const tickSec = optionalNumber("KEEPER_TICK_SEC", 60);
  const gasFloorWei = BigInt(required("KEEPER_GAS_FLOOR_WEI"));

  const batchSize = Number(
    await client.readContract({ address: engine, abi: engineAbi, functionName: "MAX_DELIVER_BATCH" }),
  );

  // The id space to scan for clocked-in brokers. This port's engine deliberately has no
  // MAX_SUPPLY constant (the reference's was declared but never enforced), so the range comes from
  // config: SCAN_MAX_ID, defaulting to the beta collection's supply of 5,555.
  const scanMaxId = BigInt(optionalNumber("SCAN_MAX_ID", 5555));

  log.info(
    `keeping chain ${chain().id} via ${redact(rpcUrl())} as ${from}, ` +
      `tick ${tickSec}s, batch ${batchSize}`,
  );

  await forever(log, "tick", () => tickSec * 1000, async () => {
    await warnIfLowOnGas(from, gasFloorWei, log);

    const [current, settled] = await Promise.all([
      client.readContract({ address: engine, abi: engineAbi, functionName: "currentRound" }),
      client.readContract({ address: engine, abi: engineAbi, functionName: "settledRound" }),
    ]);

    if (current <= settled) {
      log.info(`round ${current} settled; nothing due`);
      return;
    }

    // Falling behind is visible rather than silent. It self-heals — `settle()` closes every elapsed
    // round in one call — but an operator should be able to see that it happened.
    const behind = current - settled;
    if (behind > 1n) log.warn(`${behind} rounds unsettled — catching up in one call`);

    const potBefore = await client.readContract({
      address: engine,
      abi: engineAbi,
      functionName: "pendingPot",
      args: [zeroAddress],
    });

    await send(wallet, { address: engine, abi: engineAbi, functionName: "settle", args: [] });

    const potAfter = await client.readContract({
      address: engine,
      abi: engineAbi,
      functionName: "pendingPot",
      args: [zeroAddress],
    });
    log.info(
      `settled through round ${current}: ETH pot ${log.eth(potBefore)} -> ${log.eth(potAfter)}`,
    );

    await deliverAll(wallet, engine, batchSize, scanMaxId);
  }, "keeper");
}

/**
 * Deliver to every broker that has credit.
 *
 * ⚠️⚠️ **Broker state is read from the ENGINE, never the NFT.** Under the OpenSea-native pivot
 * `book.contracts.nft` is a plain factory clone that exposes neither `MAX_SUPPLY` nor `isActive` —
 * those are the engine's (`BrokerEngine`: `mapping public isActive`, `MAX_DELIVER_BATCH`),
 * exactly as the app reads them. An earlier version read `nft.totalMinted()`/`nft.isActive(id)` off
 * the clone; the reads reverted, `deliverAll` threw every round, and the keeper paid nobody while the
 * container stayed healthy. The id space is the engine's `MAX_SUPPLY` (the collection is sold out,
 * ids 1..2222); `deliver` is idempotent for a broker with nothing owed, which makes walking the whole
 * range acceptable rather than clever.
 */
async function deliverAll(
  wallet: ReturnType<typeof walletFor>,
  engine: `0x${string}`,
  batchSize: number,
  supply: bigint,
): Promise<void> {
  const client = publicClient();

  const ids: bigint[] = [];
  for (let id = 1n; id <= supply; id++) ids.push(id);

  // ⚠️⚠️ Read `isActive` in bounded chunks — never one `supply`-wide multicall. viem splits a read
  // that wide into ~150 internal `aggregate3` calls, and any transport batching then collapses them
  // into one oversized JSON-RPC request the node rejects — which `allowFailure` reports as every id
  // failed, indistinguishable from "nobody is clocked in". That is exactly what paid no one for
  // weeks (see `shared/chain.ts`). Chunking keeps each request small regardless of transport, and a
  // chunk that truly fails is surfaced rather than silently counted as an inactive broker.
  const READ_CHUNK = 400;
  const earning: bigint[] = [];
  let failedReads = 0;
  for (let i = 0; i < ids.length; i += READ_CHUNK) {
    const slice = ids.slice(i, i + READ_CHUNK);
    // Typed as `unknown` results on purpose: viem infers a union across every function in
    // `engineAbi`, so it cannot narrow this call's return to `boolean` and a direct `=== true` is a
    // type error about a comparison that is in fact exactly right.
    //
    // `batchSize` large enough that a whole `READ_CHUNK` is ONE `aggregate3` call: a single large
    // `eth_call` is fine (only the JSON-RPC *batch* of ~150 tiny calls was rejected). This is the
    // difference between ~1s and ~40s for the full sweep — measured on the mainnet archive node.
    const reads = (await client.multicall({
      allowFailure: true,
      batchSize: 200_000,
      contracts: slice.map((id) => ({ address: engine, abi: engineAbi, functionName: "isActive", args: [id] })),
    })) as { status: "success" | "failure"; result?: unknown }[];
    reads.forEach((read, j) => {
      const id = slice[j];
      if (id === undefined) return;
      if (read?.status === "success") {
        if (read.result === true) earning.push(id);
      } else {
        failedReads++;
      }
    });
  }

  // ⚠️ A failed read is NOT an inactive broker. Counting it as one is exactly how a broken
  // full-collection read masqueraded as "nobody clocked in" — so it is surfaced loudly rather than
  // folded into the count below.
  if (failedReads > 0) {
    log.warn(`${failedReads} of ${supply} isActive reads failed this tick — those brokers may be skipped until it clears`);
  }

  // ⚠️ Expected until holders clock in. `clockIn` reverts `TokenNotSet` until `setRobinToken` is
  // spent, so between the engine deploy and that one-shot every broker is inactive and there is
  // genuinely nobody to pay. Said plainly here so an operator watching the first weeks does not read
  // silence as breakage.
  if (earning.length === 0) {
    log.info(`no brokers are clocked in of ${supply} — nothing to deliver`);
    return;
  }
  log.info(`${earning.length} brokers clocked in — delivering in batches of ${batchSize}`);

  for (let i = 0; i < earning.length; i += batchSize) {
    const batch = earning.slice(i, i + batchSize);
    await send(wallet, { address: engine, abi: engineAbi, functionName: "sync", args: [batch] });
    await send(wallet, { address: engine, abi: engineAbi, functionName: "deliver", args: [batch] });
    log.info(`delivered ${batch.length} brokers (${i + batch.length}/${earning.length} clocked in)`);

    // ⚠️ Heartbeat on PROGRESS, not only between ticks. A full-collection delivery is many batches of
    // sequential on-chain sends and, once per round, can outlast the healthcheck window — beating
    // only after the whole tick returns would let a HEALTHY keeper look unhealthy and be restarted
    // mid-delivery. Gated on `log.healthy()` so a keeper that has gone out of gas (a fatal flag set
    // on the failed send) stops beating and correctly goes stale.
    if (log.healthy()) beat("keeper");
  }
}

async function send(
  wallet: ReturnType<typeof walletFor>,
  call: Parameters<ReturnType<typeof publicClient>["simulateContract"]>[0],
): Promise<void> {
  const client = publicClient();
  try {
    // Simulated first: a revert caught here is a sentence, a revert on chain is gas spent to learn
    // the same thing.
    const { request } = await client.simulateContract({ ...call, account: wallet.account });
    // ⚠️⚠️ Gas buffer. viem sets the tx gas limit to `eth_estimateGas` with NO headroom, and
    // `deliver` swaps ETH for the asset through a proxy — a deep call the EIP-150 63/64 rule then
    // starves, so the bare estimate (~1.96M for 11 brokers) reverted on chain with "out of gas" in
    // that sub-call while the identical call succeeded at ≥2.2M. It delivered to nobody, silently.
    // Double the estimate; unused gas is refunded and this chain's block gas limit is effectively
    // unbounded, so the only cost is a larger balance reservation at broadcast.
    const gas = request.gas === undefined ? undefined : request.gas * 2n;
    const hash = await wallet.writeContract({ ...request, gas, chain: chain() });
    const receipt = await client.waitForTransactionReceipt({ hash });
    // ⚠️⚠️ `waitForTransactionReceipt` RESOLVES on a reverted tx (`status: "reverted"`) — it does
    // not throw. Without this a `deliver` that reverted on chain looked delivered, which is the
    // other half of why holders saw no rewards: the keeper logged success over a reverted payout.
    if (receipt.status === "reverted") {
      throw new Error(`tx ${hash} reverted on chain (gas used ${receipt.gasUsed})`);
    }
  } catch (error) {
    // A batch that reverts must not stop the ones after it. Nothing is lost by skipping — the
    // credit stays in the engine and the next tick tries again.
    log.expected("call", error);
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
