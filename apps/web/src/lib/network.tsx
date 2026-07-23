"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { base, baseSepolia, robinhoodTestnet } from "wagmi/chains";
import type { Network, NetworkId } from "@/lib/mock-data";

/**
 * Real connected-network + wallet context for the app shell (Phase B).
 *
 * Backed by wagmi `useAccount` — NOT mock data. Exposes the actually-connected address (or an
 * honest disconnected state), the real chain, an explorer base, and real disconnect / chain-switch
 * actions. Sui is shown as a documented fast-follow (NOT "live") — the earlier mock marked it live.
 */

// §B3: Robinhood testnet (46630) is a supported network for chat + read-only portfolio (the vault
// stays Base-only — the vault pages still show their own "not on this network" state off Base).
const SUPPORTED = new Set<number>([base.id, baseSepolia.id, robinhoodTestnet.id]);
const EXPLORER: Record<number, string> = {
  [base.id]: "https://basescan.org",
  [baseSepolia.id]: "https://sepolia.basescan.org",
  [robinhoodTestnet.id]: "https://explorer.testnet.chain.robinhood.com",
};
/** The chain the develop vault lives on — where an off-network wallet is prompted to switch. */
const PREFERRED_CHAIN = baseSepolia;

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
 * Chains offered in the in-app network switcher. Alpha is testnet-only, so only the testnet chains
 * are switchable here (Base mainnet is configured in wagmi for RECOGNITION but is intentionally not
 * offered on the testnet alpha). Because both chains are registered in {@link wagmiConfig}, a single
 * `switchChain({ chainId })` also triggers the wallet's `wallet_addEthereumChain` when the chain is
 * unknown — so no manual add-chain call is needed to get a user onto Robinhood testnet.
 */
const SWITCHABLE: SwitchableNetwork[] = [
  { chainId: baseSepolia.id, name: "Base Sepolia", color: "#0052FF", live: true },
  { chainId: robinhoodTestnet.id, name: "Robinhood Testnet", color: "#00C805", live: true },
];

const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "Not connected");

function chainName(chainId?: number): string {
  if (chainId === base.id) return "Base";
  if (chainId === baseSepolia.id) return "Base Sepolia";
  if (chainId === robinhoodTestnet.id) return "Robinhood Testnet";
  return "Unsupported network";
}

interface NetworkContextValue {
  networks: Network[];
  activeNetwork: NetworkId;
  /** The active network for display (name reflects the REAL connected chain). */
  network: Network;
  /** Short connected address, or "Not connected". */
  wallet: string;
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

  const switchToBase = useCallback(() => {
    switchChain({ chainId: PREFERRED_CHAIN.id });
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
    const onSupportedChain = chainId !== undefined && SUPPORTED.has(chainId);
    const network: Network = {
      id: "base",
      name: chainName(chainId),
      color: onSupportedChain ? "#0052FF" : "#f59e0b",
      live: onSupportedChain,
      wallet: "",
    };
    return {
      networks: NETWORKS,
      activeNetwork: "base",
      network,
      wallet: isConnected ? short(address) : "Not connected",
      address,
      isConnected,
      chainId,
      onSupportedChain,
      networkSettling: isConnected && status !== "connected",
      explorerBase: (chainId && EXPLORER[chainId]) || EXPLORER[PREFERRED_CHAIN.id],
      setActiveNetwork: () => undefined,
      switchableNetworks: SWITCHABLE,
      switchToChain,
      switchToBase,
      disconnectWallet,
    };
  }, [address, chainId, isConnected, status, switchToChain, switchToBase, disconnectWallet]);

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
  return ctx;
}
