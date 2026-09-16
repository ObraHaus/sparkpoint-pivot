"use client";

/**
 * useBrokerEngine — every read and write the 4663 beta broker surface makes (W.3.3).
 *
 * The beta's broker system is NOT the 043 surface this app grew for 46630. There is no sale and no
 * activation registry: the collection is an OpenSea drop clone and the verbs live on the deployed
 * `BrokerEngine` (proxy `0x08a578…DB43`), which burns the Pons utility token via `burnFrom` and
 * burns absorbed NFTs on fusion. Ownership is read from the clone; everything else is the engine's.
 *
 * Four rules hold throughout, each paid for somewhere:
 *
 *   1. **A read that failed is `undefined`, never zero.** "Unread" and "nothing" are different
 *      facts, and rendering the second for the first tells a holder they have nothing (the same
 *      discipline as `brokers.ts`).
 *   2. **A reverted receipt is NOT a success.** `useWaitForTransactionReceipt` resolves for a
 *      reverted transaction exactly as it does for a mined one; reporting wagmi's query flag would
 *      announce "Fused." over a transaction that did nothing.
 *   3. **Approve spender == allowance spender.** The engine is what calls `burnFrom`, so the
 *      allowance read must ask about the ENGINE — an allowance read against any other address
 *      stays zero forever and the approve button never flips.
 *   4. **The approval reads poll.** wagmi does not refetch a contract read on its own; after an
 *      approval confirms, a frozen allowance keeps `needsApproval` true and the next button never
 *      appears. The poll is the fix, not a nicety.
 *
 * Alpha/testnet never imports this module — the legacy page's code path is untouched (W.3.4 gates
 * on the app chain and renders only on the beta build).
 */

import { useCallback, useMemo } from "react";
import { erc20Abi, type Address, type Hex } from "viem";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { brokerEngineAbi } from "@sparkpoint/shared/abis";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { CHAIN_IDS } from "@sparkpoint/shared/chains";
import { useIndexedBrokers } from "@/lib/chain/useIndexedBrokers";
import type { WagmiChainId } from "@/lib/wagmi";

/** The chain the beta revenue subsystem lives on. Pinned: no read or write follows the wallet. */
export const BROKER_ENGINE_CHAIN = CHAIN_IDS.robinhoodMainnet as WagmiChainId;

/**
 * The slice of the OpenSea drop clone this app binds.
 *
 * Hand-written because the clone is not a T015 output (it was launched through OpenSea, not
 * deployed from this repo) — the same call the companion app made for `CLONE_ABI`. Every function
 * here is verified present on `0x706b…3d3f` (eth_call, 2026-09-16): `totalSupply`, `maxSupply`,
 * `ownerOf` and `burn` all answered; the ERC-721 approval pair is the standard surface.
 *
 * `maxSupply` is the immutable drop size; `totalSupply` is the LIVE count, which a fusion moves
 * down (the absorbed token is burned) while `maxSupply` stays put. The gallery wants both: supply
 * for "minted", totalSupply for "still exists".
 */
export const brokerCloneAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

/** The beta deployment, as the shared book carries it. Every field optional: fail-closed. */
export interface BrokerDeployment {
  readonly chainId: number;
  readonly nft?: Address;
  readonly engine?: Address;
  readonly vault?: Address;
  readonly token?: Address;
  readonly splitter?: Address;
  readonly sink?: Address;
  readonly treasury?: Address;
  readonly curve?: Address;
  readonly feeEscrow?: Address;
}

/**
 * Resolve the 4663 broker deployment from the address book — the ONE source of truth, never a
 * literal in a component. A chain the book cannot serve yields all-`undefined` and every screen
 * below says so honestly.
 */
export function useBrokerDeployment(): BrokerDeployment {
  return useMemo(() => {
    try {
      const book = getAddresses(CHAIN_IDS.robinhoodMainnet);
      return {
        chainId: CHAIN_IDS.robinhoodMainnet,
        nft: book.brokerNft,
        engine: book.brokerEngine,
        vault: book.brokerVault,
        token: book.utilityToken,
        splitter: book.revenueSplitter,
        sink: book.royaltySink,
        treasury: book.revenueTreasury,
        curve: book.ponsCurve,
        feeEscrow: book.ponsFeeEscrow,
      };
    } catch {
      return { chainId: CHAIN_IDS.robinhoodMainnet };
    }
  }, []);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reads
 * ──────────────────────────────────────────────────────────────────────────── */

/** The six settable burns, plus native ETH. `undefined` on any term = not read yet. */
export interface BrokerBurnPrices {
  readonly clockIn?: bigint;
  readonly analyst?: bigint;
  readonly associate?: bigint;
  readonly partner?: bigint;
  readonly fuseTwo?: bigint;
  readonly fuseThree?: bigint;
}

export interface BrokerBurnPriceState {
  readonly prices: BrokerBurnPrices;
  /** Every term answered. Anything less and a screen quoting a cost must say it is still reading. */
  readonly live: boolean;
  readonly isLoading: boolean;
}

/**
 * What clocking in, each rank and each fusion cost **right now**.
 *
 * These are storage on the engine, owner-settable at any time, so nothing that leads a holder
 * toward a burn may hardcode them. Partial answers are refused as a set: a mixed read would quote
 * a price that is neither the old one nor the new one, which is the hardest wrong number to spot.
 */
export function useBrokerBurnPrices(engine: Address | undefined): BrokerBurnPriceState {
  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: engine
      ? ([
          { address: engine, abi: brokerEngineAbi, functionName: "clockInBurn" },
          { address: engine, abi: brokerEngineAbi, functionName: "internBurn" },
          { address: engine, abi: brokerEngineAbi, functionName: "managerBurn" },
          { address: engine, abi: brokerEngineAbi, functionName: "directorBurn" },
          { address: engine, abi: brokerEngineAbi, functionName: "fuseBurnTwo" },
          { address: engine, abi: brokerEngineAbi, functionName: "fuseBurnThree" },
        ] as const)
      : [],
    query: { enabled: Boolean(engine) },
  });

  return useMemo(() => {
    const at = (i: number) => {
      const r = data?.[i];
      return r?.status === "success" && typeof r.result === "bigint" ? r.result : undefined;
    };
    const prices: BrokerBurnPrices = {
      clockIn: at(0),
      analyst: at(1),
      associate: at(2),
      partner: at(3),
      fuseTwo: at(4),
      fuseThree: at(5),
    };
    const live =
      prices.clockIn !== undefined &&
      prices.analyst !== undefined &&
      prices.associate !== undefined &&
      prices.partner !== undefined &&
      prices.fuseTwo !== undefined &&
      prices.fuseThree !== undefined;
    return { prices, live, isLoading };
  }, [data, isLoading]);
}

/** The ETH revenue waiting to be settled into the accumulator (`pendingPot(address(0))`). */
export function useBrokerPot(engine: Address | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    address: engine,
    abi: brokerEngineAbi,
    functionName: "pendingPot",
    args: [("0x0000000000000000000000000000000000000000" as Address)],
    query: { enabled: Boolean(engine) },
  });

  return { eth: data as bigint | undefined, isLoading, refetch };
}

export interface BrokerCollection {
  /** The immutable drop size (`maxSupply`). */
  readonly maxSupply?: bigint;
  /** The LIVE count (`totalSupply`) — falls when a fusion burns an absorbed broker. */
  readonly totalSupply?: bigint;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

/** The clone's supply pair. Both numbers are read; neither is derived from the other. */
export function useBrokerCollection(nft: Address | undefined): BrokerCollection {
  const { data, isLoading, refetch } = useReadContracts({
    allowFailure: true,
    contracts: nft
      ? ([
          { address: nft, abi: brokerCloneAbi, functionName: "maxSupply" },
          { address: nft, abi: brokerCloneAbi, functionName: "totalSupply" },
        ] as const)
      : [],
    query: { enabled: Boolean(nft) },
  });

  const at = (i: number) => {
    const r = data?.[i];
    return r?.status === "success" && typeof r.result === "bigint" ? r.result : undefined;
  };

  return { maxSupply: at(0), totalSupply: at(1), isLoading, refetch };
}

/** The engine's per-broker state, as one row of the gallery. */
export interface BetaBroker {
  readonly id: bigint;
  /** `ownerOf` — `undefined` when unread OR when the id was burned by a fusion. */
  readonly owner?: Address;
  /** False when the chain could not be read at all, so nothing else on this row means anything. */
  readonly readable: boolean;
  /** `ownerOf` reverted on a reachable chain: this id no longer exists (absorbed by a fusion). */
  readonly absorbed: boolean;
  /** `isActive` — clocked in and earning. */
  readonly isActive?: boolean;
  /** `rankOf` — 0..3. */
  readonly rank?: number;
  /** `weightOf` — the accumulator cache; 0 unless clocked in. */
  readonly weight?: bigint;
  /** `deriveWeight` — the weight clocking in grants at the current rank. */
  readonly potentialWeight?: bigint;
  /** `parts` — 0, 2 or 3 (fused). */
  readonly parts?: number;
  /** `tierBurned` — utility tokens this broker's rank has already burned (promotion charges the rest). */
  readonly tierBurned?: bigint;
  /** `earnedOf(id, ETH)` — banked + uncrystallised, in wei. */
  readonly earnedEth?: bigint;
}

const READS_PER_BROKER = 8;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type ReadOutcome = { readonly status?: "success" | "failure"; readonly result?: unknown };

/**
 * The engine + ownership state for a list of ids, in ONE batched query.
 *
 * Ownership is the clone's; everything else is the engine's. A burned id's `ownerOf` reverts —
 * which is how a fusion shows up here — but `allowFailure` reports the same `failure` for a call
 * that reverted and one that never arrived, so `readable` is derived from the OTHER reads
 * succeeding. Without that distinction an RPC outage would render as "every broker was absorbed".
 */
export function useBrokerEngineStates(
  ids: readonly bigint[],
  deployment: BrokerDeployment,
): { brokers: BetaBroker[]; isLoading: boolean; refetch: () => void } {
  const { nft, engine } = deployment;

  const contracts = useMemo(
    () =>
      ids.flatMap((id) => [
        { address: nft, abi: brokerCloneAbi, functionName: "ownerOf" as const, args: [id] },
        { address: engine, abi: brokerEngineAbi, functionName: "isActive" as const, args: [id] },
        { address: engine, abi: brokerEngineAbi, functionName: "rankOf" as const, args: [id] },
        { address: engine, abi: brokerEngineAbi, functionName: "weightOf" as const, args: [id] },
        { address: engine, abi: brokerEngineAbi, functionName: "deriveWeight" as const, args: [id] },
        { address: engine, abi: brokerEngineAbi, functionName: "parts" as const, args: [id] },
        { address: engine, abi: brokerEngineAbi, functionName: "tierBurned" as const, args: [id] },
        {
          address: engine,
          abi: brokerEngineAbi,
          functionName: "earnedOf" as const,
          args: [id, ZERO],
        },
      ]),
    [ids, nft, engine],
  );

  const { data, isLoading, refetch } = useReadContracts({
    allowFailure: true,
    contracts,
    query: { enabled: Boolean(nft) && Boolean(engine) && ids.length > 0 },
  });

  const brokers = useMemo<BetaBroker[]>(() => {
    const rows = (data ?? []) as readonly ReadOutcome[];
    const ok = (i: number) => rows[i]?.status === "success";
    const value = <T,>(i: number): T | undefined => (ok(i) ? (rows[i]?.result as T) : undefined);

    return ids.map((id, n) => {
      const base = n * READS_PER_BROKER;
      const ownerReadable = ok(base + 0);
      const engineReadable =
        ok(base + 1) ||
        ok(base + 2) ||
        ok(base + 3) ||
        ok(base + 4) ||
        ok(base + 5) ||
        ok(base + 6) ||
        ok(base + 7);
      const readable = ownerReadable || engineReadable;

      return {
        id,
        owner: value<Address>(base + 0),
        readable,
        absorbed: !ownerReadable && engineReadable,
        isActive: value<boolean>(base + 1),
        rank: value<number>(base + 2),
        weight: value<bigint>(base + 3),
        potentialWeight: value<bigint>(base + 4),
        parts: value<number>(base + 5),
        tierBurned: value<bigint>(base + 6),
        earnedEth: value<bigint>(base + 7),
      };
    });
  }, [ids, data]);

  return { brokers, isLoading, refetch };
}

/** The scan bound: a browser walk of `1..totalSupply`, never unbounded. */
export const OWNERSHIP_SCAN_LIMIT = 500;

export interface OwnedBrokers {
  /** Every id the surface queried (its gallery candidates). */
  readonly ids: readonly bigint[];
  /** The subset this wallet holds, absent ids (burned by fusion) excluded. */
  readonly mine: readonly BetaBroker[];
  /** The scan hit its cap: the list is incomplete and the screen must say so. */
  readonly truncated: boolean;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

/**
 * Which brokers the connected wallet holds — the ONE implementation both broker surfaces use.
 *
 * Two ownership paths, deliberately: `GET /brokers/owned` walks `Transfer` logs and scales to the
 * full 5,555, while a bounded `1..totalSupply` browser scan survives an agent outage. The indexer
 * is preferred; it reports `available: false` (never an empty list) when it cannot read, which is
 * what makes the fallback honest rather than a silent "you own nothing".
 *
 * ⚠️ Walks `1..totalSupply` (the clone's live count), not `maxSupply`: ids above the minted range
 * do not exist, and asking for them would report every one as absorbed.
 */
export function useOwnedBrokers(deployment: BrokerDeployment): OwnedBrokers {
  const { address, isConnected, chainId: walletChain } = useAccount();
  const walletReady = isConnected && walletChain === deployment.chainId;
  const collection = useBrokerCollection(deployment.nft);

  const indexed = useIndexedBrokers(walletReady);
  const scanIds = useMemo(() => {
    if (collection.totalSupply === undefined) return [];
    const count = Number(
      collection.totalSupply > BigInt(OWNERSHIP_SCAN_LIMIT)
        ? BigInt(OWNERSHIP_SCAN_LIMIT)
        : collection.totalSupply,
    );
    return Array.from({ length: count }, (_, i) => BigInt(i + 1));
  }, [collection.totalSupply]);

  const ids = useMemo(() => {
    if (indexed.ids !== undefined) return indexed.ids.map((n) => BigInt(n));
    return indexed.source === "scan" ? scanIds : [];
  }, [indexed.ids, indexed.source, scanIds]);

  const states = useBrokerEngineStates(ids, deployment);
  const mine = useMemo(() => {
    if (!address) return [];
    const want = address.toLowerCase();
    return states.brokers.filter(
      (b) => b.owner !== undefined && b.owner.toLowerCase() === want && !b.absorbed,
    );
  }, [states.brokers, address]);

  const truncated =
    indexed.source === "scan" &&
    collection.totalSupply !== undefined &&
    collection.totalSupply > BigInt(OWNERSHIP_SCAN_LIMIT);

  return {
    ids,
    mine,
    truncated,
    isLoading: indexed.source === "loading" || collection.isLoading || states.isLoading,
    refetch: states.refetch,
  };
}

/** What the wallet holds of the tokens the engine burns, and what it has approved. */
export interface BurnPosition {
  /** The wallet's utility-token balance. */
  readonly balance?: bigint;
  /** `allowance(wallet, ENGINE)` — the spender is the engine, never the NFT. */
  readonly allowance?: bigint;
  /** The token's own symbol, for copy ("1 SPARKYTEST"), read live. */
  readonly symbol?: string;
  /** `isApprovedForAll(wallet, engine)` on the clone — only fusion needs it. */
  readonly nftApproved?: boolean;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

/**
 * The approval/balance reads every burning verb needs, in one place.
 *
 * ⚠️ Polls every 5s. wagmi does not refetch a contract read on its own, so after an approval
 * confirms a frozen allowance would keep `needsApproval` true and leave the holder with an
 * "Approve" button that never turns into the verb (bug shipped once in the companion app, caught
 * only by an end-to-end run).
 */
export function useBurnPosition(deployment: BrokerDeployment): BurnPosition {
  const { address } = useAccount();
  const { token, engine, nft } = deployment;
  const enabled = Boolean(address) && Boolean(token) && Boolean(engine);
  const RE = 5_000;

  const { data, isLoading, refetch } = useReadContracts({
    allowFailure: true,
    contracts:
      address && token && engine && nft
        ? ([
            { address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] },
            { address: token, abi: erc20Abi, functionName: "allowance", args: [address, engine] },
            { address: token, abi: erc20Abi, functionName: "symbol" },
            { address: nft, abi: brokerCloneAbi, functionName: "isApprovedForAll", args: [address, engine] },
          ] as const)
        : [],
    query: { enabled: enabled && Boolean(nft), refetchInterval: RE },
  });

  const at = <T,>(i: number): T | undefined => {
    const r = data?.[i];
    return r?.status === "success" ? (r.result as T) : undefined;
  };

  return {
    balance: at<bigint>(0),
    allowance: at<bigint>(1),
    symbol: at<string>(2),
    nftApproved: at<boolean>(3),
    isLoading,
    refetch: () => void refetch(),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Writes
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BrokerTxState {
  /** Waiting on the wallet. */
  readonly isSigning: boolean;
  /** Signed, waiting on the chain. */
  readonly isMining: boolean;
  /** Mined AND `status === "success"` — never just "the receipt arrived". */
  readonly isSuccess: boolean;
  readonly hash: Hex | undefined;
  /** In the product's language, or `undefined`. */
  readonly error: string | undefined;
  readonly reset: () => void;
}

const REVERT_COPY =
  "The transaction was mined but reverted, so nothing changed. Check the explorer for the reason.";

function walletError(error: { shortMessage?: string; message?: string }): string {
  const msg = error.shortMessage ?? error.message ?? "The transaction failed.";
  if (/user rejected|denied|rejected the request/i.test(msg)) return "You cancelled the signature.";
  return msg.length > 140 ? `${msg.slice(0, 140)}…` : msg;
}

/**
 * One feed for every verb — a holder does not care which contract a call lands on, only whether it
 * is waiting on their wallet, waiting on the chain, or finished. `useWriteContract` +
 * `useWaitForTransactionReceipt`, collapsed.
 *
 * Exported because the revenue surface's `withdraw` is the same shape on a different contract; a
 * second copy of the reverted-receipt rule is a second chance to get it wrong.
 */
export function useBrokerTx() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isMining, data: receipt } = useWaitForTransactionReceipt({ hash });

  const reverted = receipt?.status === "reverted";

  return {
    writeContract,
    state: {
      isSigning: isPending,
      isMining,
      isSuccess: receipt?.status === "success",
      hash,
      error: error ? walletError(error) : reverted ? REVERT_COPY : undefined,
      reset,
    } satisfies BrokerTxState,
  };
}

/** Put a broker to work. Burns `clockInBurn` utility tokens; idempotence is NOT the chain's job. */
export function useClockIn(deployment: BrokerDeployment) {
  const { engine } = deployment;
  const { writeContract, state } = useBrokerTx();

  const clockIn = useCallback(
    (id: bigint) => {
      if (!engine) return;
      writeContract({
        address: engine,
        abi: brokerEngineAbi,
        functionName: "clockIn",
        args: [id],
        chainId: BROKER_ENGINE_CHAIN,
      });
    },
    [engine, writeContract],
  );

  return { clockIn, ...state };
}

/** Promote a broker to rank 2 or 3. Pays the difference the broker's rank has not burned. */
export function usePromote(deployment: BrokerDeployment) {
  const { engine } = deployment;
  const { writeContract, state } = useBrokerTx();

  const promote = useCallback(
    (id: bigint, rank: number) => {
      if (!engine) return;
      writeContract({
        address: engine,
        abi: brokerEngineAbi,
        functionName: "promote",
        args: [id, rank],
        chainId: BROKER_ENGINE_CHAIN,
      });
    },
    [engine, writeContract],
  );

  return { promote, ...state };
}

/**
 * Fuse two or three owned brokers. `ids[0]` survives; the rest are burned — irreversibly.
 *
 * The array ORDER is part of the call (the first element is the survivor), so nothing in the UI
 * may sort it.
 */
export function useFuse(deployment: BrokerDeployment) {
  const { engine } = deployment;
  const { writeContract, state } = useBrokerTx();

  const fuse = useCallback(
    (ids: readonly bigint[]) => {
      if (!engine) return;
      writeContract({
        address: engine,
        abi: brokerEngineAbi,
        functionName: "fuse",
        args: [ids],
        chainId: BROKER_ENGINE_CHAIN,
      });
    },
    [engine, writeContract],
  );

  return { fuse, ...state };
}

/**
 * Approve the ENGINE to burn exactly `amount` utility tokens.
 *
 * Exact-amount, never unlimited: an unlimited approval to a contract that burns is a standing
 * licence, and this product has no reason to ask for one.
 */
export function useApproveEngineSpend(deployment: BrokerDeployment) {
  const { token, engine } = deployment;
  const { writeContract, state } = useBrokerTx();

  const approve = useCallback(
    (amount: bigint) => {
      if (!token || !engine) return;
      writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [engine, amount],
        chainId: BROKER_ENGINE_CHAIN,
      });
    },
    [token, engine, writeContract],
  );

  return { approve, ...state };
}

/**
 * Grant the engine ERC-721 operator approval on the clone — decision D2, approve-then-fuse.
 *
 * `fuse` has the engine `burn` the absorbed tokens, and the clone's burn is holder/approved-gated,
 * so the holder authorises the engine once before fusing. ERC-721 has no per-token burn allowance,
 * so this is all-or-nothing; the UI must explain it and let the holder revoke it afterwards.
 */
export function useApproveEngineNft(deployment: BrokerDeployment) {
  const { nft, engine } = deployment;
  const { writeContract, state } = useBrokerTx();

  const approveNft = useCallback(
    (approved: boolean) => {
      if (!nft || !engine) return;
      writeContract({
        address: nft,
        abi: brokerCloneAbi,
        functionName: "setApprovalForAll",
        args: [engine, approved],
        chainId: BROKER_ENGINE_CHAIN,
      });
    },
    [nft, engine, writeContract],
  );

  return { approveNft, ...state };
}
