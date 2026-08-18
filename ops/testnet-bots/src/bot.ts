/**
 * SparkPoint testnet activity bots.
 *
 * Drives the REAL product paths on the testnets the alpha already reads, so the revenue and
 * portfolio surfaces have something honest to show before the first whitelisted tester arrives.
 * Nothing here is shipped, and nothing here can reach a mainnet — see `assertTestnet`.
 *
 * What it does and why each one exists
 * ------------------------------------
 *   status   read-only: balances, caps, TVL, the fee state. Start here.
 *   accrue   call the vault's PERMISSIONLESS `accrueFee()`. The vault has been earning above its
 *            high-water mark for weeks with nobody realising it, so `fee_events` is empty — not
 *            because there is no yield but because nobody ever asked for it.
 *   fund     seed deterministic bot wallets with gas, and mint them test USDC from the Aave
 *            faucet. Deposits are capped PER WALLET, so TVL scales by adding wallets, not money.
 *   vault    deposit / redeem cycles, so yield accrues on a balance worth accruing on.
 *   swap     fee-bearing swaps in the exact multicall shape the app builds, so each one writes a
 *            genuine 0.20% row to `swap_fee_events`.
 *
 * The two rules this tool is built around
 * ---------------------------------------
 *   1. **Dry run by default.** Every command simulates and prints; `--broadcast` is required to
 *      send anything. A tool that moves money as a side effect of being run is a tool that moves
 *      money by accident.
 *   2. **Simulate, then send.** Every write goes through `simulateContract` first, so a revert
 *      costs nothing and is reported with its reason instead of as a failed transaction.
 *
 * Honesty obligation, inherited from the simulation stack it is modelled on: **this produces the
 * volume, it does not prove the demand.** Activity generated here is ours. It must never be
 * presented as adoption, and the figures it produces must never be shown as a forecast.
 */

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

import { erc20Abi, faucetAbi, quoterV2Abi, swapRouter02Abi, vaultAbi } from "./abis.ts";
import {
  ADDRESS_THIS,
  assertTestnet,
  chainConfig,
  ROUTING_FEE_BIPS,
  type ChainConfig,
} from "./config.ts";

// ─────────────────────────────────────────────────────────────── argument parsing

interface Args {
  command: string;
  chainId: number;
  broadcast: boolean;
  count: number;
  wallets: number;
  amount: string | undefined;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const [command = "status", ...rest] = argv;
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const has = (name: string): boolean => rest.includes(`--${name}`);
  return {
    command,
    chainId: Number(flag("chain") ?? 84532),
    broadcast: has("broadcast"),
    count: Number(flag("count") ?? 1),
    wallets: Number(flag("wallets") ?? 5),
    amount: flag("amount"),
    json: has("json"),
  };
}

// ─────────────────────────────────────────────────────────────── plumbing

const HELP = `
SparkPoint testnet activity bots — testnets only, dry-run by default.

  node --experimental-strip-types src/bot.ts <command> [flags]

Commands
  status                   read-only snapshot: gas, USDC, caps, vault TVL, fee state
  accrue                   realise the vault performance fee (permissionless)
  fund                     seed bot wallets with gas + faucet USDC
  vault                    deposit / redeem cycles through the vault
  swap                     fee-bearing swaps (writes swap_fee_events rows)

Flags
  --chain <id>             84532 (Base Sepolia, default) | 46630 (Robinhood testnet)
  --broadcast              actually send. WITHOUT THIS NOTHING IS SENT.
  --count <n>              how many actions (swap / vault cycles). Default 1.
  --wallets <n>            how many bot wallets to use. Default 5.
  --amount <decimal>       per-action size. Swap: ETH in. Vault: USDC in. Fund: ETH per wallet.
  --json                   machine-readable output

Environment
  BASE_SEPOLIA_RPC_URL     read RPC for 84532 (falls back to https://sepolia.base.org)
  DEPLOYER_PRIVATE_KEY     the FUNDER. Only used by 'fund' and 'accrue'.
  BOT_MNEMONIC             derives the bot wallets. 'fund' prints a fresh one if unset.
`;

function rpcUrl(cfg: ChainConfig): string {
  return process.env[cfg.rpcEnv] || cfg.rpcFallback;
}

async function connect(chainId: number): Promise<{ cfg: ChainConfig; pub: PublicClient }> {
  const cfg = chainConfig(chainId);
  const pub = createPublicClient({ chain: cfg.chain, transport: http(rpcUrl(cfg)) }) as PublicClient;
  // ⚠️ Read the id from the LIVE connection, then assert. Trusting the config here would defeat
  // the check entirely — a wrong RPC URL is exactly the mistake it exists to catch.
  const live = await pub.getChainId();
  assertTestnet(live, cfg.id);
  return { cfg, pub };
}

function funderAccount() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set — 'fund' and 'accrue' need the funder");
  return privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
}

/** Deterministic bot wallets. One mnemonic, N addresses — reproducible across runs and machines. */
function botAccounts(n: number) {
  const mnemonic = process.env.BOT_MNEMONIC;
  if (!mnemonic) throw new Error("BOT_MNEMONIC is not set — run 'fund' first, it will mint one");
  return Array.from({ length: n }, (_, i) => mnemonicToAccount(mnemonic, { addressIndex: i }));
}

function walletFor(cfg: ChainConfig, account: ReturnType<typeof privateKeyToAccount>): WalletClient {
  return createWalletClient({ account, chain: cfg.chain, transport: http(rpcUrl(cfg)) });
}

/**
 * Pull the useful sentence out of a viem error. Its first line is usually just "the contract
 * function reverted with the following reason:" — the reason itself is on a later line, so taking
 * line one alone throws away the only part that says what went wrong.
 */
function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const lines = error.message.split("\n").map((l) => l.trim()).filter(Boolean);
  const reason = lines.find(
    (l) => !l.endsWith(":") && !l.startsWith("Contract Call") && !l.startsWith("Request Arguments"),
  );
  return (reason ?? lines[0] ?? "unknown").slice(0, 160);
}

/**
 * Simulate, then (only with --broadcast) send and wait.
 *
 * Returns the receipt, or `null` in dry-run. A revert surfaces from the simulation with its
 * decoded reason and costs nothing.
 */
async function run(
  pub: PublicClient,
  wallet: WalletClient,
  request: Record<string, unknown>,
  label: string,
  broadcast: boolean,
): Promise<{ ok: boolean; hash?: Hex; note: string }> {
  try {
    const { request: sim } = await pub.simulateContract(request as never);
    if (!broadcast) return { ok: true, note: `would ${label}` };
    const hash = await wallet.writeContract(sim as never);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    return {
      ok: receipt.status === "success",
      hash,
      note: `${label} — ${receipt.status}, gas ${receipt.gasUsed}`,
    };
  } catch (error) {
    return { ok: false, note: `REFUSED ${label}: ${reasonOf(error)}` };
  }
}

const fmt = (v: bigint, d: number) => formatUnits(v, d);

// ─────────────────────────────────────────────────────────────── status

async function cmdStatus(args: Args): Promise<void> {
  const { cfg, pub } = await connect(args.chainId);
  const funder = process.env.DEPLOYER_PRIVATE_KEY ? funderAccount().address : undefined;

  console.log(`\n${cfg.label} (${cfg.id})  ·  block ${await pub.getBlockNumber()}`);
  console.log(`rpc: ${new URL(rpcUrl(cfg)).host}`);

  if (funder) {
    const [eth, usdc] = await Promise.all([
      pub.getBalance({ address: funder }),
      pub.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [funder] }),
    ]);
    console.log(`\nfunder ${funder}`);
    console.log(`  gas   ${formatEther(eth)} ETH`);
    console.log(`  USDC  ${fmt(usdc as bigint, cfg.usdcDecimals)}`);
  }

  if (process.env.BOT_MNEMONIC) {
    console.log(`\nbot wallets (${args.wallets})`);
    for (const account of botAccounts(args.wallets)) {
      const [eth, usdc] = await Promise.all([
        pub.getBalance({ address: account.address }),
        pub.readContract({
          address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
        }),
      ]);
      console.log(
        `  ${account.address}  ${formatEther(eth).padStart(12)} ETH  ` +
          `${fmt(usdc as bigint, cfg.usdcDecimals).padStart(12)} USDC`,
      );
    }
  } else {
    console.log("\nbot wallets: BOT_MNEMONIC unset (run 'fund' to mint one)");
  }

  if (cfg.vault) {
    const [assets, supply, hwm, feeBps, paused] = await Promise.all([
      pub.readContract({ address: cfg.vault, abi: vaultAbi, functionName: "totalAssets" }),
      pub.readContract({ address: cfg.vault, abi: vaultAbi, functionName: "totalSupply" }),
      pub.readContract({ address: cfg.vault, abi: vaultAbi, functionName: "highWaterMark" }),
      pub.readContract({ address: cfg.vault, abi: vaultAbi, functionName: "performanceFeeBps" }),
      pub.readContract({ address: cfg.vault, abi: vaultAbi, functionName: "paused" }),
    ]);
    const sharePrice = (assets as bigint) * 10n ** 18n / ((supply as bigint) || 1n);
    console.log(`\nvault ${cfg.vault}`);
    console.log(`  TVL          ${fmt(assets as bigint, cfg.usdcDecimals)} USDC`);
    console.log(`  share price  ${formatEther(sharePrice)}`);
    console.log(`  high-water   ${formatEther(hwm as bigint)}`);
    console.log(`  fee rate     ${Number(feeBps) / 100}%   paused: ${paused}`);
    // The whole reason `accrue` exists: this line tells you whether there is anything to realise.
    const claimable = sharePrice > (hwm as bigint);
    console.log(
      claimable
        ? `  ⇒ share price is ABOVE the high-water mark: accrueFee() would mint a fee now`
        : `  ⇒ at or below the high-water mark: accrueFee() would be a no-op`,
    );
  }
  console.log("");
}

// ─────────────────────────────────────────────────────────────── accrue

async function cmdAccrue(args: Args): Promise<void> {
  const { cfg, pub } = await connect(args.chainId);
  if (!cfg.vault) throw new Error(`${cfg.label} carries no vault`);
  const account = funderAccount();
  const wallet = walletFor(cfg, account);

  const before = (await pub.readContract({
    address: cfg.vault, abi: vaultAbi, functionName: "totalSupply",
  })) as bigint;

  const result = await run(
    pub,
    wallet,
    { address: cfg.vault, abi: vaultAbi, functionName: "accrueFee", account, args: [] },
    "accrueFee()",
    args.broadcast,
  );
  console.log(result.note + (result.hash ? `  ${result.hash}` : ""));

  if (result.ok && args.broadcast) {
    const after = (await pub.readContract({
      address: cfg.vault, abi: vaultAbi, functionName: "totalSupply",
    })) as bigint;
    const minted = after - before;
    console.log(
      minted > 0n
        ? `fee shares minted: ${formatUnits(minted, cfg.usdcDecimals)} — a PerformanceFeeAccrued event now exists`
        : `no shares minted: the vault was at or below its high-water mark`,
    );
  }
}

// ─────────────────────────────────────────────────────────────── fund

async function cmdFund(args: Args): Promise<void> {
  const { cfg, pub } = await connect(args.chainId);
  const account = funderAccount();
  const wallet = walletFor(cfg, account);

  if (!process.env.BOT_MNEMONIC) {
    const { generateMnemonic, english } = await import("viem/accounts");
    console.log("\nBOT_MNEMONIC is unset. Here is a fresh one — store it in the workspace keystore");
    console.log("(.claude/.env), NEVER in the repo, then re-run:\n");
    console.log(`  BOT_MNEMONIC="${generateMnemonic(english)}"\n`);
    console.log("These wallets are the bots' own. Do not reuse the project's testnet wallets.");
    return;
  }

  const perWallet = parseUnits(args.amount ?? "0.0002", 18);
  const accounts = botAccounts(args.wallets);
  const funderBalance = await pub.getBalance({ address: account.address });
  const needed = perWallet * BigInt(accounts.length);

  console.log(`\nfunding ${accounts.length} wallets with ${formatEther(perWallet)} ETH each`);
  console.log(`  funder holds ${formatEther(funderBalance)} ETH, this needs ${formatEther(needed)} ETH`);
  if (needed > funderBalance) throw new Error("funder cannot cover this — lower --wallets or --amount");

  for (const bot of accounts) {
    const have = await pub.getBalance({ address: bot.address });
    if (have >= perWallet) {
      console.log(`  ${bot.address}  already funded (${formatEther(have)} ETH)`);
      continue;
    }
    if (!args.broadcast) {
      console.log(`  ${bot.address}  would send ${formatEther(perWallet - have)} ETH`);
      continue;
    }
    const hash = await wallet.sendTransaction({
      account, chain: cfg.chain, to: bot.address, value: perWallet - have,
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  ${bot.address}  funded  ${hash}`);
  }

  if (!cfg.usdcFaucet) {
    console.log(`\n${cfg.label} has no test-USDC faucet — skipping the USDC leg.`);
    return;
  }
  // ⚠️ The faucet is per-address rate-limited, which is precisely why the fleet scales by adding
  // wallets rather than by minting more to one. Each bot mints its own.
  const mintAmount = parseUnits("5000", cfg.usdcDecimals);
  console.log(`\nminting ${fmt(mintAmount, cfg.usdcDecimals)} test USDC per wallet (per-wallet vault cap)`);
  for (const bot of accounts) {
    const held = (await pub.readContract({
      address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [bot.address],
    })) as bigint;
    if (held >= mintAmount) {
      console.log(`  ${bot.address}  already holds ${fmt(held, cfg.usdcDecimals)}`);
      continue;
    }
    const result = await run(
      pub,
      walletFor(cfg, bot as never),
      {
        address: cfg.usdcFaucet, abi: faucetAbi, functionName: "mint",
        account: bot, args: [cfg.usdc, bot.address, mintAmount],
      },
      `mint USDC → ${bot.address}`,
      args.broadcast,
    );
    console.log(`  ${result.note}`);
  }
}

// ─────────────────────────────────────────────────────────────── vault

async function cmdVault(args: Args): Promise<void> {
  const { cfg, pub } = await connect(args.chainId);
  if (!cfg.vault) throw new Error(`${cfg.label} carries no vault (offersVault=false, by design)`);
  const vault = cfg.vault;
  const accounts = botAccounts(args.wallets);

  for (const bot of accounts) {
    const wallet = walletFor(cfg, bot as never);
    const [held, capRemaining] = await Promise.all([
      pub.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [bot.address] }),
      pub.readContract({ address: vault, abi: vaultAbi, functionName: "maxDeposit", args: [bot.address] }),
    ]);
    // ⚠️ Clamp to BOTH the wallet's balance and the per-user cap. The cap is 5,000 USDC and it is
    // enforced on chain — a deposit over it reverts, so this is what makes the fleet size, rather
    // than the deposit size, the thing that moves TVL.
    const want = args.amount
      ? parseUnits(args.amount, cfg.usdcDecimals)
      : (held as bigint);
    const amount = [want, held as bigint, capRemaining as bigint].reduce((a, b) => (a < b ? a : b));

    if (amount === 0n) {
      console.log(`${bot.address}  nothing to deposit (holds ${fmt(held as bigint, cfg.usdcDecimals)}, cap left ${fmt(capRemaining as bigint, cfg.usdcDecimals)})`);
      continue;
    }

    const allowance = (await pub.readContract({
      address: cfg.usdc, abi: erc20Abi, functionName: "allowance", args: [bot.address, vault],
    })) as bigint;
    if (allowance < amount) {
      const approved = await run(
        pub, wallet,
        { address: cfg.usdc, abi: erc20Abi, functionName: "approve", account: bot, args: [vault, amount] },
        `approve ${fmt(amount, cfg.usdcDecimals)} USDC`,
        args.broadcast,
      );
      console.log(`${bot.address}  ${approved.note}`);
      if (!approved.ok) continue;
      if (!args.broadcast) {
        // The deposit CANNOT simulate before the approve lands — transferFrom would revert on
        // allowance. Saying so beats printing a revert that looks like a real problem.
        console.log(`${bot.address}  deposit not simulated — needs the approve above to land first`);
        continue;
      }
    }

    const deposited = await run(
      pub, wallet,
      { address: vault, abi: vaultAbi, functionName: "deposit", account: bot, args: [amount, bot.address] },
      `deposit ${fmt(amount, cfg.usdcDecimals)} USDC`,
      args.broadcast,
    );
    console.log(`${bot.address}  ${deposited.note}`);
  }

  const tvl = (await pub.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" })) as bigint;
  console.log(`\nvault TVL now ${fmt(tvl, cfg.usdcDecimals)} USDC`);
  console.log(
    "Yield accrues with TIME, not with deposits — the performance fee only exists once the share " +
      "price passes the high-water mark. Run 'accrue' later, not immediately.",
  );
}

// ─────────────────────────────────────────────────────────────── swap

/**
 * Quote the ONE pinned pool. Never shops across tiers — see `ChainConfig.swapPoolFee` for why
 * doing so turns the fleet into an arbitrage bot instead of a user simulator.
 */
async function quotePinned(
  pub: PublicClient, cfg: ChainConfig, tokenIn: Address, tokenOut: Address, amountIn: bigint,
): Promise<bigint | null> {
  if (cfg.swapPoolFee === undefined) return null;
  try {
    const { result } = await pub.simulateContract({
      address: cfg.quoterV2,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee: cfg.swapPoolFee, sqrtPriceLimitX96: 0n }],
    });
    const out = (result as readonly bigint[])[0] ?? 0n;
    return out > 0n ? out : null;
  } catch {
    return null;
  }
}

/**
 * Refuse a trade that is a meaningful share of the pool.
 *
 * ⚠️ This is the guard the measurements demanded. Base Sepolia's tier-500 WETH/USDC pool holds
 * 0.0338 WETH — a single 0.0002 ETH trade is 0.6% of it, and forty of them would take a quarter
 * of the pool. Moving the price a real tester is quoted is a worse outcome than having no bot
 * data at all, so the reserves are read LIVE and the trade is sized against them rather than
 * against a number someone wrote down once.
 */
async function poolDepthOk(
  pub: PublicClient, cfg: ChainConfig, token: Address, amount: bigint,
): Promise<{ ok: boolean; note: string }> {
  if (cfg.swapPoolFee === undefined || !cfg.uniswapV3Factory) {
    return { ok: false, note: "no pinned pool configured for this chain" };
  }
  const factoryAbi = [{
    type: "function", name: "getPool", stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
    outputs: [{ type: "address" }],
  }] as const;
  const pool = (await pub.readContract({
    address: cfg.uniswapV3Factory, abi: factoryAbi, functionName: "getPool",
    args: [cfg.weth, cfg.usdc, cfg.swapPoolFee],
  })) as Address;
  if (pool === "0x0000000000000000000000000000000000000000") {
    return { ok: false, note: `no pool at tier ${cfg.swapPoolFee}` };
  }
  const reserve = (await pub.readContract({
    address: token, abi: erc20Abi, functionName: "balanceOf", args: [pool],
  })) as bigint;
  if (reserve === 0n) return { ok: false, note: "pool reserve is zero" };
  const shareBps = (amount * 10_000n) / reserve;
  const limit = BigInt(cfg.maxPoolShareBps ?? 50);
  return shareBps <= limit
    ? { ok: true, note: `${Number(shareBps) / 100}% of pool` }
    : {
        ok: false,
        note: `trade is ${Number(shareBps) / 100}% of the pool (limit ${Number(limit) / 100}%) — it would move the price`,
      };
}

async function cmdSwap(args: Args): Promise<void> {
  const { cfg, pub } = await connect(args.chainId);
  if (cfg.swapPoolFee === undefined) {
    throw new Error(
      `swapping is disabled on ${cfg.label}: its WETH/USDC pools are too shallow to trade without ` +
        `moving the price real testers are quoted (tier 500 holds ~0.034 WETH). ` +
        `Use --chain 46630, where the tier-3000 pool holds ~2,311 WETH.`,
    );
  }
  const accounts = botAccounts(args.wallets);
  const amountIn = parseUnits(args.amount ?? "0.0002", 18);

  console.log(`\n${cfg.label}: ${args.count} swap(s) of ${formatEther(amountIn)} ETH → USDC`);
  console.log(`pinned to pool fee tier ${cfg.swapPoolFee} (never quote-shopped — see config.ts)`);
  console.log(`routing fee ${Number(ROUTING_FEE_BIPS) / 100}% → ${cfg.feeRecipient}\n`);

  // Size the trade against the pool BEFORE looking at any wallet: being too big for the pool is
  // a property of the trade, and reporting it as "wallet underfunded" would send the operator
  // hunting for the wrong problem.
  const sizeCheck = await poolDepthOk(pub, cfg, cfg.weth, amountIn);
  console.log(
    sizeCheck.ok
      ? `trade size: ${sizeCheck.note} — safe\n`
      : `\n✗ REFUSED: ${sizeCheck.note}\n`,
  );
  if (!sizeCheck.ok) return;

  const feeBefore = (await pub.readContract({
    address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [cfg.feeRecipient],
  })) as bigint;

  for (let i = 0; i < args.count; i++) {
    const bot = accounts[i % accounts.length]!;
    const wallet = walletFor(cfg, bot as never);
    // ⚠️ Alternate direction. A buy-only fleet converts all its ETH into USDC and then cannot pay
    // for gas OR for the next swap — the same reason the simulation stack's trader is two-sided.
    // Selling accrues the fee just as buying does, so this is throughput, not decoration.
    const selling = i % 2 === 1;

    const gas = await pub.getBalance({ address: bot.address });
    if (gas <= amountIn / 4n) {
      console.log(`${bot.address}  skipped — ${formatEther(gas)} ETH is not enough for gas`);
      continue;
    }

    let result: { ok: boolean; hash?: Hex; note: string };
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

    if (!selling) {
      if (gas <= amountIn) {
        console.log(`${bot.address}  skipped buy — holds ${formatEther(gas)} ETH, needs > ${formatEther(amountIn)}`);
        continue;
      }
      const depth = await poolDepthOk(pub, cfg, cfg.weth, amountIn);
      if (!depth.ok) {
        console.log(`${bot.address}  REFUSED buy — ${depth.note}`);
        continue;
      }
      const out = await quotePinned(pub, cfg, cfg.weth, cfg.usdc, amountIn);
      if (out === null) {
        console.log(`${bot.address}  skipped — pinned pool did not quote ETH→USDC`);
        continue;
      }
      const quote = { fee: cfg.swapPoolFee, amountOut: out };
      // 1% slippage floor; well inside the 300 bps policy ceiling the app clamps to.
      const minOut = (quote.amountOut * 9900n) / 10_000n;
      // The exact shape `useExecuteSwapTx` builds: swap into the router, then the fee-bearing
      // sweep forwards (output − 0.20%) to the user and the fee straight to the recipient.
      const calls = [
        encodeFunctionData({
          abi: swapRouter02Abi, functionName: "exactInputSingle",
          args: [{
            tokenIn: cfg.weth, tokenOut: cfg.usdc, fee: quote.fee,
            recipient: ADDRESS_THIS, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
          }],
        }),
        encodeFunctionData({
          abi: swapRouter02Abi, functionName: "sweepTokenWithFee",
          args: [cfg.usdc, minOut, bot.address, ROUTING_FEE_BIPS, cfg.feeRecipient],
        }),
      ];
      result = await run(
        pub, wallet,
        {
          address: cfg.swapRouter02, abi: swapRouter02Abi, functionName: "multicall",
          account: bot, args: [deadline, calls], value: amountIn,
        },
        `BUY  ${formatEther(amountIn)} ETH → ~${fmt(quote.amountOut, cfg.usdcDecimals)} USDC (tier ${quote.fee})`,
        args.broadcast,
      );
    } else {
      // Sell whatever USDC the bot picked up on its buy leg.
      const held = (await pub.readContract({
        address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [bot.address],
      })) as bigint;
      if (held === 0n) {
        console.log(`${bot.address}  skipped sell — holds no USDC yet (buy first)`);
        continue;
      }
      const depth = await poolDepthOk(pub, cfg, cfg.usdc, held);
      if (!depth.ok) {
        console.log(`${bot.address}  REFUSED sell — ${depth.note}`);
        continue;
      }
      const out = await quotePinned(pub, cfg, cfg.usdc, cfg.weth, held);
      if (out === null) {
        console.log(`${bot.address}  skipped — pinned pool did not quote USDC→ETH`);
        continue;
      }
      const quote = { fee: cfg.swapPoolFee, amountOut: out };
      const allowance = (await pub.readContract({
        address: cfg.usdc, abi: erc20Abi, functionName: "allowance",
        args: [bot.address, cfg.swapRouter02],
      })) as bigint;
      if (allowance < held) {
        const approved = await run(
          pub, wallet,
          {
            address: cfg.usdc, abi: erc20Abi, functionName: "approve",
            account: bot, args: [cfg.swapRouter02, held],
          },
          `approve ${fmt(held, cfg.usdcDecimals)} USDC to the router`,
          args.broadcast,
        );
        console.log(`${bot.address}  ${approved.note}`);
        if (!approved.ok || !args.broadcast) continue;
      }
      const minOut = (quote.amountOut * 9900n) / 10_000n;
      const calls = [
        encodeFunctionData({
          abi: swapRouter02Abi, functionName: "exactInputSingle",
          args: [{
            tokenIn: cfg.usdc, tokenOut: cfg.weth, fee: quote.fee,
            recipient: ADDRESS_THIS, amountIn: held, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
          }],
        }),
        encodeFunctionData({
          abi: swapRouter02Abi, functionName: "unwrapWETH9WithFee",
          args: [minOut, bot.address, ROUTING_FEE_BIPS, cfg.feeRecipient],
        }),
      ];
      result = await run(
        pub, wallet,
        {
          address: cfg.swapRouter02, abi: swapRouter02Abi, functionName: "multicall",
          account: bot, args: [deadline, calls],
        },
        `SELL ${fmt(held, cfg.usdcDecimals)} USDC → ~${formatEther(quote.amountOut)} ETH (tier ${quote.fee})`,
        args.broadcast,
      );
    }
    console.log(`${bot.address}  ${result.note}${result.hash ? `  ${result.hash}` : ""}`);
  }

  if (args.broadcast) {
    const feeAfter = (await pub.readContract({
      address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [cfg.feeRecipient],
    })) as bigint;
    console.log(`\nfee recipient received ${fmt(feeAfter - feeBefore, cfg.usdcDecimals)} USDC this run`);
    console.log("The swap-fee indexer picks these up within ~5 minutes.");
  }
  // ⚠️ Say this every run, because the mismatch it explains looks exactly like a broken indexer.
  console.log(
    "\n⚠️ Only the BUY legs will appear in /admin/revenue. A sell pays its fee in native ETH via\n" +
      "   unwrapWETH9WithFee, which emits no ERC-20 Transfer — and `swap_fee_indexer` matches only\n" +
      "   ERC-20 Transfer logs. That fee is real and it is received; it is simply never counted.\n" +
      "   This is a gap in revenue accounting, not in the bots. It affects real users too.",
  );
}

// ─────────────────────────────────────────────────────────────── entry

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || args.command === "--help") {
    console.log(HELP);
    return;
  }
  if (!args.broadcast && args.command !== "status") {
    console.log("\n── DRY RUN ── nothing will be sent. Add --broadcast to act.");
  }
  switch (args.command) {
    case "status": return cmdStatus(args);
    case "accrue": return cmdAccrue(args);
    case "fund":   return cmdFund(args);
    case "vault":  return cmdVault(args);
    case "swap":   return cmdSwap(args);
    default:
      console.log(HELP);
      throw new Error(`unknown command '${args.command}'`);
  }
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
