/**
 * 048 / T303 — where the "Deposit" CTA on a curated vault actually goes.
 *
 * The hybrid model (locked decision D4): a curated vault WITH a SparkPoint performance-fee wrapper
 * routes to the wrapper deposit and discloses the fee; a curated vault WITHOUT one is still
 * depositable DIRECTLY (no SparkPoint fee, disclosed). The contract work itself is gated (M1) on a
 * live vault existing on the chain, so a wrapper that is claimed but not deployed must render an
 * honest "not yet" — never a dead CTA, and never a fee attached to nothing.
 *
 * PURE and total: every branch is decided here so both surfaces and the unit tests agree, and no
 * branch fabricates a destination. An external vault gets its explorer address page (the user's own
 * wallet is the only thing that can deposit into a raw ERC-4626), not an in-app flow that does not
 * exist.
 */

/**
 * The explorer link is INJECTED rather than imported: this module stays dependency-free (relative
 * imports only) so `node --experimental-strip-types` can run its tests, and the app passes
 * `explorerAddressUrl`. Tests pass a stub.
 */
export type ExplorerLink = (chainId: number, address: string) => string | undefined;

export interface RailVault {
  chainId: number;
  address: string;
  label: string;
  wrapped: boolean;
  wrapperAddress: string | null;
  depositMode: "direct" | "wrapper";
}

/** An in-app vault the existing deposit flow already understands. */
export interface KnownVault {
  address: string;
  /** e.g. `/vault/deposit?vault=0x…` */
  depositHref: string;
}

export type DepositRail =
  | {
      kind: "wrapper";
      /** The wrapper deposit page (performance fee disclosed on the next screen). */
      href: string;
      label: string;
      disclosure: string;
    }
  | {
      kind: "wrapper-pending";
      label: string;
      /** Why there is no CTA yet. Rendered, not hidden. */
      note: string;
    }
  | {
      kind: "direct";
      /** The existing in-app deposit flow (this vault is already registered here). */
      href: string;
      label: string;
      disclosure: string;
    }
  | {
      kind: "direct-external";
      /** The vault's explorer page — a raw ERC-4626 deposit is user-signed, in their wallet. */
      href: string;
      label: string;
      disclosure: string;
    };

/** Case-insensitive address membership over the app's known vaults. */
export function findKnownVault(
  address: string | null | undefined,
  known: KnownVault[],
): KnownVault | undefined {
  if (!address) return undefined;
  const target = address.toLowerCase();
  return known.find((k) => k.address.toLowerCase() === target);
}

export function wrapperFeeDisclosure(wrapperLabel: string): string {
  return (
    `SparkPoint's performance fee applies only to gains above the high-water mark — ` +
    `no deposit fee, no withdrawal fee, and nothing charged on a flat or losing position. ` +
    `Your deposit goes to ${wrapperLabel}.`
  );
}

export function directFeeDisclosure(): string {
  return (
    "No SparkPoint wrapper is attached to this vault — SparkPoint charges no fee. You deposit " +
    "directly into the vault contract from your own wallet, and you can withdraw directly at any " +
    "time."
  );
}

export function depositRail(
  vault: RailVault,
  known: KnownVault[],
  explorer: ExplorerLink,
): DepositRail {
  if (vault.wrapped) {
    const wrapper = findKnownVault(vault.wrapperAddress, known);
    if (wrapper) {
      return {
        kind: "wrapper",
        href: wrapper.depositHref,
        label: "Deposit via SparkPoint wrapper",
        disclosure: wrapperFeeDisclosure(vault.label),
      };
    }
    // Claimed wrapped but no deployed wrapper in this build: M1 is gated, and a CTA here would
    // deposit without the fee wrapper the vault is described as having. Say so instead.
    return {
      kind: "wrapper-pending",
      label: "Wrapper not deployed yet",
      note:
        "This vault is planned to have a SparkPoint performance-fee wrapper, but that wrapper is " +
        "not deployed yet. Nothing is deposit-ready here — check back after the operator deploys it.",
    };
  }

  const local = findKnownVault(vault.address, known);
  if (local) {
    return {
      kind: "direct",
      href: local.depositHref,
      label: "Deposit direct",
      disclosure: directFeeDisclosure(),
    };
  }

  const explorerHref = explorer(vault.chainId, vault.address);
  if (!explorerHref) {
    // No explorer and no in-app rail: there is no honest destination, so there is no link.
    return {
      kind: "wrapper-pending",
      label: "Deposit unavailable here",
      note:
        "This vault isn't registered with SparkPoint and this chain has no public explorer to " +
        "open it in. Deposit from a wallet that supports the chain directly.",
    };
  }
  return {
    kind: "direct-external",
    href: explorerHref,
    label: "Deposit direct in your wallet",
    disclosure: directFeeDisclosure(),
  };
}
