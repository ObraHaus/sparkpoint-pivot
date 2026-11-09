"use client";

/**
 * 075 — NearWalletProvider + useNearWallet.
 *
 * The provider owns ONE client-side NEAR connection (Meteor first) and exposes only connect /
 * disconnect / accountId / signMessage. The account id is a CLIENT-SIDE CLAIM: it is never sent to
 * the agent as authentication and never authorises anything. It cannot affect the EVM/SIWE session
 * — disconnecting or switching the NEAR wallet never touches the SIWE cookie, and vice versa.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createNearWalletAdapter,
  type NearAccount,
  type NearSignMessageParams,
  type NearSignedMessage,
  type NearWalletAdapter,
  type SendTransactionsOptions,
} from "./adapter";
import type { NearTransaction, NearTransactionOutcome } from "./burrow.ts";
import { nearNetworkFromEnv, nearRpcUrlFromEnv, type NearNetwork } from "./network";

export type NearWalletStatus = "idle" | "connecting" | "connected";

export interface NearWalletContextValue {
  readonly accountId: string | null;
  readonly network: NearNetwork;
  readonly rpcUrl?: string;
  readonly status: NearWalletStatus;
  readonly error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (params: NearSignMessageParams) => Promise<NearSignedMessage>;
  /** 078 — live earn confirm only. Re-checks the connected account immediately before the wallet call. */
  getConnectedAccount: () => Promise<NearAccount | null>;
  sendTransactions: (
    transactions: readonly NearTransaction[],
    options?: SendTransactionsOptions,
  ) => Promise<NearTransactionOutcome[]>;
}

const NearWalletContext = createContext<NearWalletContextValue | null>(null);

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/rejected|denied|cancel|closed/i.test(raw)) {
    return "You cancelled the NEAR wallet request. Nothing was signed.";
  }
  return raw || "The NEAR wallet could not complete that request.";
}

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const network = useMemo<NearNetwork>(() => nearNetworkFromEnv(), []);
  const rpcUrl = useMemo<string | undefined>(() => nearRpcUrlFromEnv(), []);
  const adapterRef = useRef<NearWalletAdapter | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [status, setStatus] = useState<NearWalletStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const adapter = useCallback((): NearWalletAdapter => {
    adapterRef.current ??= createNearWalletAdapter({ network });
    return adapterRef.current;
  }, [network]);

  // Restore the display id from local storage. This is a convenience only; it is never trusted.
  useEffect(() => {
    let cancelled = false;
    void adapter()
      .getAccount()
      .then((account: NearAccount | null) => {
        if (!cancelled && account) {
          setAccountId(account.accountId);
          setStatus("connected");
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const account = await adapter().connect();
      setAccountId(account.accountId);
      setStatus("connected");
    } catch (err) {
      setAccountId(null);
      setStatus("idle");
      setError(messageOf(err));
    }
  }, [adapter]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await adapter().disconnect();
    } finally {
      setAccountId(null);
      setStatus("idle");
    }
  }, [adapter]);

  const signMessage = useCallback(
    async (params: NearSignMessageParams) => adapter().signMessage(params),
    [adapter],
  );

  const getConnectedAccount = useCallback(async () => adapter().getConnectedAccount(), [adapter]);
  const sendTransactions = useCallback(
    async (transactions: readonly NearTransaction[], options?: SendTransactionsOptions) =>
      adapter().sendTransactions(transactions, options),
    [adapter],
  );

  const value = useMemo<NearWalletContextValue>(
    () => ({
      accountId,
      network,
      rpcUrl,
      status,
      error,
      connect,
      disconnect,
      signMessage,
      getConnectedAccount,
      sendTransactions,
    }),
    [
      accountId,
      network,
      rpcUrl,
      status,
      error,
      connect,
      disconnect,
      signMessage,
      getConnectedAccount,
      sendTransactions,
    ],
  );

  return <NearWalletContext.Provider value={value}>{children}</NearWalletContext.Provider>;
}

export function useNearWallet(): NearWalletContextValue {
  const ctx = useContext(NearWalletContext);
  if (!ctx) throw new Error("useNearWallet must be used within a NearWalletProvider");
  return ctx;
}
