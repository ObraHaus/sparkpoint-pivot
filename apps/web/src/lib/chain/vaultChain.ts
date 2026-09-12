/**
 * Is the vault's chain (`VAULT_CHAIN_ID`, Base Sepolia today) actually REGISTERED in THIS build's
 * wagmi config?
 *
 * On the alpha/testnet build it is (Base Sepolia is one of the registered chains), so vault reads
 * work exactly as before. On the mainnet-beta build wagmi registers ONLY Robinhood Chain 4663 (no
 * Base — "no base network for now"), so the vault chain is NOT registered: a wagmi read scoped to it
 * throws `ChainNotConfiguredError` inside react-query and the surface would sit on a perpetual
 * "Reading…"/"read error" instead of an honest "no vault on this network" state. The vault is
 * genuinely Base-only and absent from the mainnet beta, so every vault surface gates its reads on
 * this flag and renders a clean unavailable state when it is false.
 *
 * WHY IT LIVES HERE (not in appChain.ts): `wagmi.ts` imports `appChain.ts` (for APP_DEFAULT_CHAIN_ID),
 * so appChain must NOT import wagmi — that would be a cycle. This tiny module imports both and is
 * imported by nobody in that chain, so it is cycle-free.
 */

import { VAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { wagmiConfig } from "@/lib/wagmi";

/** True iff `VAULT_CHAIN_ID` is a chain THIS build actually registered in wagmi (⇒ vault reads can run). */
export const VAULT_CHAIN_AVAILABLE: boolean = wagmiConfig.chains.some((c) => c.id === VAULT_CHAIN_ID);
