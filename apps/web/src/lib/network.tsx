"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { base, baseSepolia, robinhoodTestnet } from "wagmi/chains";
import {
  PREFERRED_CHAIN_ID,
  SWITCHABLE_CHAINS,
  chainName,
  explorerRoot,
  isSupportedChain,
} from "@sparkpoint/shared/chains";
import { wagmiConfig } from "@/lib/wagmi";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import type { Network, NetworkId } from "@/lib/mock-data";
import { useSession } from "@/lib/auth/useSiwe";
import { viewerState } from "@/lib/auth/viewerState";

/**
 * Real connected-network + wallet context for the app shell (Phase B).
 *
 * Backed by wagmi `useAccount` — NOT mock data. Exposes the actually-connected address (or an
 * honest disconnected state), the real chain, an explorer base, and real disconnect / chain-switch
 * actions. Sui is shown as a documented fast-follow (NOT "live") — the earlier mock marked it live.
 */

// §B3: Robinhood testnet (46630) is a supported network for chat + read-only portfolio (the vault
// stays Base-only — the vault pages still show their own "not on this network" state off Base).
//
// 024 — these were four independent re-derivations (a SUPPORTED set, an EXPLORER map, a SWITCHABLE
// list and a chainName() switch) sitting beside the list `wagmi.ts` actually registers, so the two
// could disagree about which chains exist. They now all read from `@sparkpoint/shared/chains`, the
// single chain-metadata registry, and `wagmi.ts` asserts its own coverage against the same source.

/** Honest display list for the network menu. Base is live; Sui is a fast-follow, not live. */
const NETWORKS: Network[] = [
  { id: "base", name: "Base", color: "#0052FF", live: true, wallet: "" },
  { id: "sui", name: "Sui", color: "#4DA8FF", live: false, wallet: "" },
];

/** The chain ids wagmi is configured for (Base · Base Sepolia · Robinhood testnet). */
export type SupportedChainId = typeof base.id | typeof baseSepolia.id | typeof robinhoodTestnet.id;

/** A chain the user can switch to from the in-app network menu. */
export interface SwitchableNetwork {
  chainId: SupportedChainId;
  name: string;
  color: string;
  live: boolean;
}

/**
 * Chains offered in the in-app network switcher: those that are BOTH `switchable` in the shared
 * registry AND registered in THIS build's {@link wagmiConfig}. `switchChain` can only target a
 * REGISTERED chain, so offering one this build didn't register would be a dead menu entry. The
 * mainnet-beta build registers only Robinhood Chain 4663 → it offers only Robinhood Chain; the
 * alpha/testnet build registers Base + Base Sepolia + Robinhood testnet → it offers exactly its
 * testnet chains (Robinhood mainnet is `switchable` in the registry but NOT registered on alpha, so
 * it is correctly withheld there). Registered chains also trigger `wallet_addEthereumChain` on switch
 * when unknown, so no manual add-chain call is needed.
 */
const REGISTERED_CHAIN_IDS = new Set<number>(wagmiConfig.chains.map((c) => c.id));
const SWITCHABLE: SwitchableNetwork[] = SWITCHABLE_CHAINS.filter((c) =>
  REGISTERED_CHAIN_IDS.has(c.chainId),
).map((c) => ({
  chainId: c.chainId as SupportedChainId,
  name: c.name,
  color: c.color,
  live: true,
}));

interface NetworkContextValue {
  networks: Network[];
  activeNetwork: NetworkId;
  /** The active network for display (name reflects the REAL connected chain). */
  network: Network;
  /** Short connected address / NEAR account, or "Not connected". */
  wallet: string;
  /** A server-verified NEAR-only session (NEP-413). EVM-only actions must NOT treat this as a wallet. */
  nearSignedIn: boolean;
  /** Any signed-in identity (EVM wallet or verified NEAR session). */
  signedIn: boolean;
  /** The NEAR account id for a verified NEAR session, else undefined. */
  nearAccount?: string;
  /** The full connected address (undefined when disconnected). */
  address?: `0x${string}`;
  isConnected: boolean;
  chainId?: number;
  /** True iff connected to Base or Base Sepolia. */
  onSupportedChain: boolean;
  /** Connected but the connection hasn't SETTLED yet (connecting/reconnecting) — chainId is not yet
   * trustworthy, so a consumer must NOT scream "wrong network" during this window. */
  networkSettling: boolean;
  /** Basescan base URL for the active chain (defaults to Base Sepolia when off-network). */
  explorerBase: string;
  /** Kept for compatibility; only "base" is selectable (Sui is a fast-follow). */
  setActiveNetwork: (id: NetworkId) => void;
  /** The chains offered in the in-app network switcher (testnet chains for the alpha). */
  switchableNetworks: SwitchableNetwork[];
  /** Prompt the wallet to switch to (and add, if unknown) a supported chain by id. */
  switchToChain: (chainId: SupportedChainId) => void;
  /** Prompt the wallet to switch to the supported develop chain (Base Sepolia). */
  switchToBase: () => void;
  /** Real wagmi disconnect + server session logout. */
  disconnectWallet: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const { address, chainId, isConnected, status } = useAccount();
  const { session } = useSession();
  const { disconnectAsync } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnectAsync();
    } finally {
      // End the server session too, so the middleware no longer treats this browser as signed in.
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    }
  }, [disconnectAsync]);

  const switchToChain = useCallback(
    (id: SupportedChainId) => {
      switchChain({ chainId: id });
    },
    [switchChain],
  );

  // Switch to the chain THIS build targets (Base Sepolia on alpha, Robinhood Chain 4663 on the
  // mainnet-beta) — both registered. Using the static PREFERRED_CHAIN_ID (84532) would target an
  // unregistered chain on beta and silently no-op.
  const switchToBase = useCallback(() => {
    switchChain({ chainId: APP_DEFAULT_CHAIN_ID as SupportedChainId });
  }, [switchChain]);

  // Disconnect watcher — end the server session when the wallet disconnects in the EXTENSION (not
  // via the in-app Disconnect button, which already logs out). A SIWE session is tied to a specific
  // wallet; once no wallet is connected, the httpOnly sp_session cookie must not keep admitting this
  // browser (esp. a stale `beta` claim). Fires ONLY on a genuine connected → disconnected
  // transition, never on the initial not-yet-connected render — that would drop a valid cookie
  // before wagmi finishes reconnecting on load. Idempotent + complements the per-wallet binding in
  // useSession(). NON-CUSTODY: clears the access cookie only — never the wallet, keys, or funds.
  const wasConnectedRef = useRef(false);
  useEffect(() => {
    const was = wasConnectedRef.current;
    wasConnectedRef.current = isConnected;
    if (was && !isConnected) {
      void fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    }
  }, [isConnected]);

  const value = useMemo<NetworkContextValue>(() => {
    const onSupportedChain = isSupportedChain(chainId);
    const viewer = viewerState({
      evmConnected: isConnected,
      evmAddress: address,
      evmChainName: chainName(chainId),
      session,
    });
    const network: Network = {
      id: "base",
      name: viewer.networkLabel,
      color: viewer.nearSignedIn ? "#00ec97" : onSupportedChain ? "#0052FF" : "#f59e0b",
      live: onSupportedChain,
      wallet: "",
    };
    return {
      networks: NETWORKS,
      activeNetwork: "base",
      network,
      wallet: viewer.walletLabel,
      nearSignedIn: viewer.nearSignedIn,
      signedIn: viewer.signedIn,
      nearAccount: viewer.nearAccount ?? undefined,
      address,
      isConnected,
      chainId,
      onSupportedChain,
      networkSettling: isConnected && status !== "connected",
      explorerBase: explorerRoot(chainId) ?? explorerRoot(PREFERRED_CHAIN_ID) ?? "",
      setActiveNetwork: () => undefined,
      switchableNetworks: SWITCHABLE,
      switchToChain,
      switchToBase,
      disconnectWallet,
    };
  }, [address, chainId, isConnected, status, session, switchToChain, switchToBase, disconnectWallet]);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
  return ctx;
}
