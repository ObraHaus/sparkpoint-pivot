"use client";

/**
 * VaultPicker — 011 multi-vault selector. A segmented control (the design's `.seg`) that chooses which
 * vault the /vault overview + deposit/withdraw flow targets. Selection lives in the URL `?vault=<address>`
 * (absent ⇒ the launch Aave vault) so it survives the /vault → /vault/deposit route hop and is shareable.
 * One option (launch only) ⇒ renders nothing, so a chain without a wrapper is byte-identical to before.
 *
 * NON-CUSTODY: this only navigates + labels — it adds NO gate. The deposit provenance/asset fail-close
 * lives in the confirm gate; withdraw is never gated (N2). The wrapper's live `factory.isSparkPointVault`
 * attestation is surfaced here as a trust badge only (informational).
 */
import { useRouter, usePathname } from "next/navigation";
import { useVault } from "@/lib/chain/useVault";
import type { VaultOption } from "@/lib/chain/vaultOptions";

/** Tiny attestation chip (mirrors the swap TokenPicker). `undefined` (loading / no factory) shows nothing. */
function VerifiedChip({ verified }: { verified?: boolean }) {
  if (verified === undefined) return null;
  return (
    <span
      aria-label={verified ? "verified" : "unverified"}
      style={{
        marginLeft: 6,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: 0.2,
        padding: "0 5px",
        borderRadius: 5,
        color: verified ? "var(--gain)" : "var(--caution)",
        background: verified ? "var(--gain-subtle)" : "var(--caution-subtle)",
      }}
    >
      {verified ? "✓" : "⚠"}
    </span>
  );
}

export function VaultPicker({
  options,
  selected,
}: {
  options: readonly VaultOption[];
  selected: VaultOption;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // ONE live attestation read for the (single) curated wrapper — powers the trust badge. Called
  // unconditionally (before any early return) to satisfy the rules of hooks; a launch-only page passes
  // no wrapper address, so it reads the harmless launch vault and yields `factoryVerified` undefined.
  // NOTE: sources the badge from a SINGLE wrapper read — correct while the curated list is one vault;
  // a growing list would need a per-option read (child component each).
  const wrapperOpt = options.find((o) => o.kind === "morpho_wrapper");
  const soleWrapper = options.filter((o) => o.kind === "morpho_wrapper").length === 1;
  const wv = useVault({
    vaultAddress: wrapperOpt?.vaultAddress,
    kind: wrapperOpt ? "morpho_wrapper" : "aave_launch",
  });

  // One option ⇒ nothing to pick; render nothing so launch-only chains are byte-identical.
  if (options.length <= 1) return null;

  function select(o: VaultOption) {
    // Read the live query at click time (client-only) rather than via useSearchParams — keeping this
    // component out of the useSearchParams CSR-bailout so it can render inside the /vault SSR shell.
    const current = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(current);
    if (o.vaultAddress) params.set("vault", o.vaultAddress);
    else params.delete("vault"); // launch ⇒ clean URL (no ?vault)
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="seg" role="tablist" aria-label="Select vault">
      {options.map((o) => {
        const active = (o.vaultAddress ?? "launch") === (selected.vaultAddress ?? "launch");
        const isWrapper = o.kind === "morpho_wrapper";
        const showChip = isWrapper && soleWrapper && o.vaultAddress === wrapperOpt?.vaultAddress;
        // 024: a retired vault stays SELECTABLE (so a holder can reach withdraw and /portfolio), but
        // says so plainly. The deposit hard-stop lives in the confirm gate, not here — this component
        // still adds no gate.
        const retired = o.retired === true;
        return (
          <button
            key={o.vaultAddress ?? "launch"}
            role="tab"
            aria-selected={active}
            className={active ? "active" : ""}
            onClick={() => select(o)}
            title={
              retired
                ? (o.retiredReason ?? "Retired — withdrawals only.")
                : isWrapper
                  ? "Branded Morpho wrapper vault"
                  : "The conservative launch Aave vault"
            }
          >
            {o.label}
            {retired ? (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: 0.2,
                  padding: "0 5px",
                  borderRadius: 5,
                  color: "var(--muted-foreground)",
                  background: "var(--muted)",
                }}
              >
                RETIRED
              </span>
            ) : showChip ? (
              <VerifiedChip verified={wv.factoryVerified} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
