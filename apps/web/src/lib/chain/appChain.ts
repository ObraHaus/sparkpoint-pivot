/**
 * The app's resolved chain identities — the single place the web app decides "which chain does
 * this build target?" instead of hard-coding `84532` (Base Sepolia) at ~50 call sites.
 *
 * WHY THIS EXISTS. `develop` (alpha/testnet) and `main` (mainnet-beta) ship the SAME codebase to
 * different environments, distinguished only by env. Historically every "assume this chain when no
 * wallet is connected" fallback was the literal `84532`. That was correct only while the app served
 * exactly one environment; the moment the mainnet-beta serves Robinhood Chain 4663, each of those
 * literals points a disconnected user's display — and every server call scoped by `x-chain-id` — at
 * a testnet. These resolvers remove the literal so the value follows the environment.
 *
 * TWO DISTINCT PLANES (they must NOT share a value):
 *
 *  • `APP_DEFAULT_CHAIN_ID` — the chain THIS BUILD targets (display + app-scoped server calls).
 *    Resolution, first hit wins:
 *      1. `NEXT_PUBLIC_APP_CHAIN_ID` — the environment pin. Mainnet-beta sets `4663`; an unset,
 *         non-numeric, or unknown value is ignored (never trusted), falling through to…
 *      2. the lone vault-bearing switchable chain (`SWITCHABLE_CHAINS.find(offersVault)`) — what the
 *         alpha/testnet build resolves to with no env set (Base Sepolia today). This reproduces the
 *         historic `84532` literal WITHOUT hard-coding it, so develop is byte-for-byte unchanged.
 *      3. `PREFERRED_CHAIN_ID` — the registry's own last resort (also Base Sepolia today).
 *
 *  • `VAULT_CHAIN_ID` — the chain the Aave vault actually LIVES on, regardless of the connected or
 *    app chain. The vault is Base-Sepolia-only today (the mainnet-beta has no active vault, §B), and
 *    a vault read/write must target where the vault is — NOT the app chain. Derived from the registry
 *    (`offersVault`), so it is `84532` on every build today and moves on its own when the vault later
 *    deploys to a real mainnet. Behaviour-preserving: it is exactly the `84532` these sites already
 *    used, now sourced from the registry instead of a literal.
 *
 * DISPLAY / SCOPING ONLY. Neither value signs a transaction: a user tx uses the CONNECTED wallet's
 * chain (action plane), and an address always resolves through the per-chain address book (which is
 * fail-closed — a chain with no deployment yields `undefined`, never a foreign address). Picking a
 * DISPLAY default wrong shows the wrong explorer; picking an ACTION default wrong would send a tx to
 * the wrong chain — which is why the two planes are named apart and the wallet chain always wins.
 */

import {
  isSupportedChain,
  offersVault,
  PREFERRED_CHAIN_ID,
  SWITCHABLE_CHAINS,
} from "@sparkpoint/shared/chains";

/**
 * The environment pin, or `undefined` when unset / unparseable / not a chain we support. A bad value
 * is dropped rather than trusted — the caller then falls through to the registry-derived default, so
 * a typo can never silently point the app at an unknown chain.
 */
function envAppChainId(): number | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_CHAIN_ID;
  if (!raw) return undefined;
  const id = Number(raw);
  return Number.isInteger(id) && isSupportedChain(id) ? id : undefined;
}

/** The chain this build targets (see module docs). Display + app-scoped server-call scoping. */
export const APP_DEFAULT_CHAIN_ID: number =
  envAppChainId() ??
  SWITCHABLE_CHAINS.find((c) => offersVault(c.chainId))?.chainId ??
  PREFERRED_CHAIN_ID;

/** `APP_DEFAULT_CHAIN_ID` as the `x-chain-id` request-header value (transport scoping). */
export const APP_CHAIN_ID_HEADER: string = String(APP_DEFAULT_CHAIN_ID);

/**
 * The chain the Aave vault lives on (Base Sepolia today; the mainnet-beta has no active vault).
 * Use this — never `APP_DEFAULT_CHAIN_ID` — for any read or write against the vault contract.
 */
export const VAULT_CHAIN_ID: number =
  SWITCHABLE_CHAINS.find((c) => offersVault(c.chainId))?.chainId ?? APP_DEFAULT_CHAIN_ID;
