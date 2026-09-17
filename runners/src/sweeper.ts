import { curveAbi, engineAbi, royaltySinkAbi, splitterAbi } from "./shared/abis.ts";
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
 * The sweeper: moves accrued fees down the 90/10 path. **Everything it does is permissionless.**
 *
 * Three sources, in order:
 *   1. **OpenSea royalties** — the sink's `flush()` then the splitter's `distribute()`. TWO calls:
 *      `flush` moves the money to the splitter, and the splitter's `receive()` only emits an event —
 *      found on a fork in the sibling repo, 1 ETH sat in the splitter while every individual reading
 *      looked fine. Never stop after the flush.
 *   2. **The Pons bonding curve** — `splitter.sweepCurve(curve, 0)`, which sweeps, claims from the
 *      escrow and splits in ONE call. `minBuybackTokensOut = 0` because the launch has
 *      `buybackEnabled: false`. The curve comes from the book (`beta.ponsCurve`) or `CURVE_ADDRESS`.
 *   3. **The escrow** — `splitter.pull()` claims whatever the escrow has credited, then splits.
 *   4. **The engine's ERC-20 intake** — `engine.sweepAsset(asset)` for every registered asset, so
 *      the splitter's PUSHED 90% leg (a bare transfer) is booked into `pendingPot` automatically
 *      instead of waiting for a manual call. Permissionless and idempotent (the watermark makes a
 *      repeat a no-op that simulates to `NothingToDeposit`).
 *
 * ⚠️ **Post-graduation is deferred.** After the curve graduates the fee is charged by Pons' v4 hook
 * in whichever currency each swap paid out, and `sweepPoolFees` is gated so that in steady trading
 * it is Pons' own keeper's call (a buy leaves a token-denominated leg). When the token graduates,
 * set `PONS_HOOK` + `POOL_ID` and extend this file with the `sweepPool` call; the ABI is already
 * here. Nothing is lost meanwhile — fees are credited and wait.
 */
const log = logger("sweeper");

async function main(): Promise<void> {
  await assertChain();

  const book = loadDeployment();
  const wallet = walletFor(required("SWEEPER_PRIVATE_KEY"));
  const from = accountOf(wallet);
  const client = publicClient();

  const intervalSec = optionalNumber("SWEEP_INTERVAL_SEC", 300);
  const gasFloorWei = BigInt(required("SWEEPER_GAS_FLOOR_WEI"));

  // The curve is in the beta book (`beta.ponsCurve`); CURVE_ADDRESS overrides for a fresh launch.
  const curve = (process.env.CURVE_ADDRESS as `0x${string}` | undefined) ?? book.curve;

  log.info(`sweeping chain ${chain().id} via ${redact(rpcUrl())} as ${from} every ${intervalSec}s`);
  log.info(
    `splitter ${book.contracts.splitter}, sink ${book.contracts.royaltySink ?? "(none)"}, ` +
      `curve ${curve ?? "(none configured)"}, escrow ${book.escrow ?? "(none)"}`,
  );

  await forever(log, "sweep", () => intervalSec * 1000, async () => {
    await warnIfLowOnGas(from, gasFloorWei, log);

    // 1 · Royalties first. A secondary sale pays a royalty whether or not the token is wired, so
    // this is the one source that can be live before anything else is.
    if (book.contracts.royaltySink) {
      await collectRoyalties(wallet, book.contracts.royaltySink, book.contracts.splitter);
    }

    // 2 · The curve, pre-graduation. `graduated()` gates it: after graduation the curve reverts
    // `AlreadyGraduated`, which is an expected answer, not a fault.
    if (curve) {
      const graduated = await readGraduated(client, curve);
      if (graduated === true) {
        log.info("curve has graduated — hook sweep deferred (set PONS_HOOK + POOL_ID to enable)");
      } else {
        await sweepCurve(wallet, book.contracts.splitter, curve);
      }
    }

    // 3 · The escrow: claim + split. A no-op `pull` reverts `NothingToDistribute`, which `send`
    // treats as an expected answer.
    await send(wallet, { address: book.contracts.splitter, abi: splitterAbi, functionName: "pull", args: [] });

    // 4 · The engine's ERC-20 intake. The splitter's 90% leg is PUSHED to the engine as a bare
    // transfer, and the engine only books it into `pendingPot` when anyone calls
    // `sweepAsset(asset)` — permissionless, no trust in the caller, and it raises the watermark so
    // nothing books twice. Without this step a token-denominated fee (e.g. the 0.20% fee from a
    // USDG-in swap) would sit in the engine uncredited until someone called it by hand.
    await bookPushedAssets(wallet, client, book.contracts.engine);
  }, "sweeper");
}

/**
 * Book every registered ERC-20 the engine holds but has not credited (`sweepAsset`). Each call is
 * simulated first, so an asset with nothing new logs as expected and costs no gas — the loop is
 * cheap even with a full registry. The pot is read per asset so the log says what actually moved.
 */
async function bookPushedAssets(
  wallet: ReturnType<typeof walletFor>,
  client: ReturnType<typeof publicClient>,
  engine: `0x${string}`,
): Promise<void> {
  let assets: readonly `0x${string}`[] = [];
  try {
    assets = (await client.readContract({
      address: engine,
      abi: engineAbi,
      functionName: "assets",
    })) as readonly `0x${string}`[];
  } catch (error) {
    // An engine without `assets()` (pre-upgrade implementation) is not a fault — nothing to book.
    log.expected("engine.assets", error);
    return;
  }

  for (const asset of assets) {
    const potBefore = await client
      .readContract({ address: engine, abi: engineAbi, functionName: "pendingPot", args: [asset] })
      .catch(() => undefined);
    await send(wallet, { address: engine, abi: engineAbi, functionName: "sweepAsset", args: [asset] });
    const potAfter = await client
      .readContract({ address: engine, abi: engineAbi, functionName: "pendingPot", args: [asset] })
      .catch(() => undefined);
    if (potBefore !== undefined && potAfter !== undefined && potAfter > potBefore) {
      log.info(`booked pushed ${asset}: pot ${potBefore} -> ${potAfter}`);
    }
  }
}

async function readGraduated(client: ReturnType<typeof publicClient>, curve: `0x${string}`) {
  try {
    return (await client.readContract({
      address: curve,
      abi: curveAbi,
      functionName: "graduated",
    })) as boolean;
  } catch {
    // A curve without `graduated()` is still sweepable — treat unknown as "not graduated".
    return undefined;
  }
}

/**
 * Sweep + claim + split in one permissionless call, and report it in MONEY, not in calls:
 * "swept the curve" would have looked identical on the day the sweep succeeded against an empty
 * contract. The pot is read before/after so the log says what actually moved.
 */
async function sweepCurve(
  wallet: ReturnType<typeof walletFor>,
  splitter: `0x${string}`,
  curve: `0x${string}`,
): Promise<void> {
  const client = publicClient();
  const engine = (await client.readContract({
    address: splitter,
    abi: splitterAbi,
    functionName: "engine",
  })) as `0x${string}`;

  const potBefore = await client.getBalance({ address: engine });
  await send(wallet, {
    address: splitter,
    abi: splitterAbi,
    functionName: "sweepCurve",
    args: [curve, 0n],
  });
  const potAfter = await client.getBalance({ address: engine });
  const moved = potAfter > potBefore ? potAfter - potBefore : 0n;

  if (moved === 0n) {
    log.info("swept, but the pot did not grow — there was nothing to collect");
  } else {
    const treasuryShare = (moved * 10n) / 90n;
    log.info(
      `swept ${log.eth(moved + treasuryShare)} -> pot ${log.eth(moved)} (90%) ` +
        `+ treasury ~${log.eth(treasuryShare)} (10%)`,
    );
  }
}

/**
 * Move secondary-sale royalties down the 90/10 path — TWO calls; the second is the one that gets
 * forgotten. Both are permissionless and both are no-ops when there is nothing to move.
 */
async function collectRoyalties(
  wallet: ReturnType<typeof walletFor>,
  sink: `0x${string}`,
  splitter: `0x${string}`,
): Promise<void> {
  const client = publicClient();
  const [inSink, inSplitter] = await Promise.all([
    client.getBalance({ address: sink }),
    client.getBalance({ address: splitter }),
  ]);

  if (inSink > 0n) {
    log.info(`royalty sink holds ${log.eth(inSink)} — flushing`);
    await send(wallet, { address: sink, abi: royaltySinkAbi, functionName: "flush", args: [] });
  }
  // Read again: the flush just moved money here, and the pre-flush reading would miss it.
  const pending = inSink > 0n ? await client.getBalance({ address: splitter }) : inSplitter;
  if (pending > 0n) {
    log.info(`splitter holds ${log.eth(pending)} undistributed — splitting 90/10`);
    await send(wallet, { address: splitter, abi: splitterAbi, functionName: "distribute", args: [] });
  }
}

/** Send, wait, and let an expected revert be expected. */
async function send(
  wallet: ReturnType<typeof walletFor>,
  call: Parameters<ReturnType<typeof publicClient>["simulateContract"]>[0],
): Promise<void> {
  const client = publicClient();
  try {
    const { request } = await client.simulateContract({ ...call, account: wallet.account });
    const hash = await wallet.writeContract({ ...request, chain: chain() });
    await client.waitForTransactionReceipt({ hash });
  } catch (error) {
    log.expected("sweep", error);
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
