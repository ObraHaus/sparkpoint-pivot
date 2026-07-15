"use client";

/**
 * ConfirmFlow — the SHARED trust gate.
 *
 * TWO honest modes, chosen by the `onchain` prop:
 *
 *  • ONCHAIN (deposit | withdraw, `onchain` present) — the REAL gate. The old
 *    cosmetic `setTimeout` "simulation" is GONE. Before Sign is ever offered we run
 *    a live pre-sign check via {@link useConfirmPreview}: the agent `/vault/quote/*`
 *    (§3.7, through the same-origin BFF) AND a direct-RPC `previewDeposit`/
 *    `previewRedeem` eth_call. Sign is disabled until BOTH are healthy; on ANY
 *    error (unreachable quote, reverting preview, cap breach) we FAIL CLOSED — no
 *    Sign button, a clear reason. The real approve/deposit / redeem then runs
 *    through {@link useExecuteVaultTx} and the receipt links the real tx hash.
 *    (Withdraw is gated only on the on-chain preview — the agent quote never blocks
 *    an exit, N2.)
 *
 *  • PLACEHOLDER (`onchain` absent) — an HONEST, non-signable state. Vault intents
 *    point at the live Vault flow; not-yet-live intents (swap/bridge/premium) say so
 *    plainly ("ships at launch"). There is NO fake simulation, NO fake signature,
 *    and NO fabricated success receipt anywhere in this file.
 *
 * "Nothing moves until you sign." The public `/exit` + `/trust` paths do not use
 * this component and stay open + un-gated.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import { useExecuteVaultTx, type VaultExec } from "@/lib/chain/useExecuteVaultTx";
import { useConfirmPreview } from "@/lib/chain/useConfirmPreview";
import { explorerTxUrl } from "@/lib/chain/explorer";
import "@/components/screens/confirm.css";

export type ConfirmIntent = "deposit" | "withdraw" | "swap" | "premium" | "bridge";

type Mount = "route" | "inline";

/**
 * REAL-execution config for the deposit|withdraw intents. When present, ConfirmFlow
 * runs the live pre-sign check + on-chain tx; all display fields are LIVE (computed
 * by {@link useVaultConfirm} from direct-RPC reads) — there is no static fallback, so
 * a fabricated number can never render on the signing path.
 */
export interface OnchainConfirm {
  /** The resolved deposit/withdraw intent the user will sign. */
  readonly exec: VaultExec;
  /** Live header sub (amounts). */
  readonly sub: React.ReactNode;
  /** Live "Balance changes" rows (from the on-chain preview). */
  readonly bc: [label: React.ReactNode, value: React.ReactNode, color: string][];
  /** Live guardrail rows. */
  readonly guards: React.ReactNode[];
  /** Live success-receipt body (shown only after a REAL on-chain confirmation). */
  readonly okBody: React.ReactNode;
}

/** Shared chrome per intent (title / header badge / back + cancel routes). */
interface Chrome {
  title: string;
  /** header right slot: AI badge (true) or the flask icon (false). */
  badge: boolean;
  backLabel: string;
  /** "history" ⇒ router.back(); otherwise a route to push. */
  backRoute: string;
  cancelRoute: string;
}

function chromeFor(intent: ConfirmIntent): Chrome {
  switch (intent) {
    case "deposit":
      return { title: "Confirm: Deposit", badge: false, backLabel: "Back", backRoute: "history", cancelRoute: "vault" };
    case "withdraw":
      return { title: "Confirm: Withdrawal", badge: false, backLabel: "Back", backRoute: "history", cancelRoute: "vault" };
    case "swap":
      return { title: "Confirm: Swap", badge: true, backLabel: "Back to chat", backRoute: "chat", cancelRoute: "chat" };
    case "premium":
      return {
        title: "Confirm: Premium subscription",
        badge: false,
        backLabel: "Back",
        backRoute: "premium/pay",
        cancelRoute: "premium",
      };
    case "bridge":
      return { title: "Confirm: Bridge", badge: false, backLabel: "Back to bridge", backRoute: "bridge", cancelRoute: "bridge" };
  }
}

/** The animated green check that marks a finished pre-sign step. */
function StepCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="3">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

const GUARD_ICON = (
  <span className="gi">
    <Icon name="check" size={16} />
  </span>
);

/* ── dispatcher ──────────────────────────────────────────────────────────────── */

export function ConfirmFlow({
  intent,
  mount = "route",
  onchain,
}: {
  intent: ConfirmIntent;
  mount?: Mount;
  /** REAL deposit|withdraw execution (see {@link OnchainConfirm}). Absent ⇒ the honest placeholder. */
  onchain?: OnchainConfirm;
}) {
  if (onchain) {
    // The onchain path is only ever deposit|withdraw (built by useVaultConfirm).
    const side = onchain.exec.kind;
    return <OnchainConfirmFlow intent={side} mount={mount} onchain={onchain} />;
  }
  return <PlaceholderConfirm intent={intent} mount={mount} />;
}

/* ── the REAL onchain confirm (deposit | withdraw) ───────────────────────────── */

interface OnchainCopy {
  simLabel: string;
  /** deposit-only acknowledgement copy (gates the Sign button). */
  ack: string | null;
  ctrl: React.ReactNode;
  signLabel: string;
  okTitle: string;
  okCite: React.ReactNode;
  toast: string;
}

function onchainCopyFor(intent: "deposit" | "withdraw"): OnchainCopy {
  if (intent === "deposit") {
    return {
      simLabel: "Pre-trade check",
      ack: "This uses your full idle balance, leaving no USDC buffer in your wallet.",
      ctrl: (
        <span>
          <b style={{ color: "var(--foreground)" }}>Nothing moves until you sign.</b> You can cancel now with no
          effect. Sparky never holds your funds.
        </span>
      ),
      signLabel: "Sign deposit",
      okTitle: "Deposit confirmed.",
      okCite: (
        <>
          View transaction <Icon name="ext" size={11} />
        </>
      ),
      toast: "Deposit confirmed · View tx ↗",
    };
  }
  return {
    simLabel: "Pre-trade check",
    ack: null,
    ctrl: (
      <span>
        <b style={{ color: "var(--foreground)" }}>Nothing moves until you sign.</b> You can cancel now with no effect.
        Sparky never holds your funds — and can never pause or cap a withdrawal.
      </span>
    ),
    signLabel: "Sign withdrawal",
    okTitle: "Withdrawal confirmed.",
    okCite: (
      <>
        View transaction <Icon name="ext" size={11} />
      </>
    ),
    toast: "Withdrawal confirmed · View tx ↗",
  };
}

type PreviewRowStatus = "loading" | "ok" | "error";

/** One live pre-sign step row (real: the icon reflects the actual signal state). */
function PreviewStep({
  status,
  loading,
  done,
  error,
}: {
  status: PreviewRowStatus;
  loading: string;
  done: string;
  error: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        fontSize: 13,
        color: "var(--muted-foreground)",
        padding: "4px 0",
      }}
    >
      {status === "ok" ? (
        <StepCheck />
      ) : status === "error" ? (
        <span style={{ color: "var(--loss)", display: "flex" }}>
          <Icon name="alert" size={14} />
        </span>
      ) : (
        <span className="ai-dot" />
      )}
      <span>{status === "ok" ? done : status === "error" ? error : `${loading}…`}</span>
    </div>
  );
}

function OnchainConfirmFlow({
  intent,
  mount,
  onchain,
}: {
  intent: "deposit" | "withdraw";
  mount: Mount;
  onchain: OnchainConfirm;
}) {
  const router = useRouter();
  const { toast } = useOverlay();
  const chrome = chromeFor(intent);
  const copy = onchainCopyFor(intent);
  const inline = mount === "inline";

  // REAL execution controller + REAL pre-sign preview (agent quote + on-chain eth_call).
  const exec = useExecuteVaultTx(onchain.exec);
  const preview = useConfirmPreview(onchain.exec);

  const txUrl = explorerTxUrl(onchain.exec.chainId, exec.txHash);

  const [acked, setAcked] = useState(false);
  const [shake, setShake] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const doneToasted = useRef(false);
  const failToasted = useRef(false);

  const busy = exec.isBusy;
  const showDone = exec.isDone;

  const go = (route: string) => router.push(toHref(route));
  const onBack = () => (chrome.backRoute === "history" ? router.back() : go(chrome.backRoute));

  // Toast once each on success / failure (render derives the rest from `exec`).
  useEffect(() => {
    if (exec.isDone && !doneToasted.current) {
      doneToasted.current = true;
      toast(copy.toast);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec.isDone]);
  useEffect(() => {
    if (exec.error && !failToasted.current) {
      failToasted.current = true;
      toast("Transaction cancelled — nothing moved.");
    } else if (!exec.error) {
      failToasted.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec.error]);

  const previewOk = preview.status === "ok";
  const previewError = preview.status === "error";
  // Once a signature is in flight, keep the verified card + Sign stable so a
  // background preview refetch can't hide the button mid-transaction.
  const showReveal = previewOk || busy;
  const ackBlocked = copy.ack ? !acked : false;
  const signDisabled = busy || !previewOk || ackBlocked;

  function onSign() {
    if (!previewOk) return; // fail-closed: never sign off an unverified state.
    if (ackBlocked) {
      setShake(true);
      window.setTimeout(() => setShake(false), 320);
      return;
    }
    exec.start();
  }

  // ── success receipt (only after a REAL on-chain confirmation) ──
  if (showDone) {
    const receipt = (
      <div style={{ padding: inline ? "30px 22px" : "40px 24px", textAlign: "center" }}>
        <div
          className="cf-okpop"
          style={{
            width: inline ? 56 : 64,
            height: inline ? 56 : 64,
            borderRadius: "50%",
            background: "var(--gain-subtle)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 14px",
          }}
        >
          <span style={{ color: "var(--gain)" }}>
            <Icon name="check" size={inline ? 28 : 30} stroke={2.5} />
          </span>
        </div>
        <div style={{ fontSize: inline ? 18 : 20, fontWeight: 600, marginBottom: inline ? 7 : 8 }}>{copy.okTitle}</div>
        <div
          style={{
            fontSize: inline ? 13.5 : 14,
            color: "var(--muted-foreground)",
            lineHeight: 1.5,
            maxWidth: 380,
            margin: "0 auto 6px",
          }}
        >
          {onchain.okBody}
        </div>
        <a
          className="cite"
          {...(txUrl ? { href: txUrl, target: "_blank", rel: "noopener noreferrer" } : {})}
          style={{ cursor: "pointer", display: "inline-flex", marginBottom: inline ? 16 : 20 }}
        >
          {copy.okCite}
        </a>
        <div style={{ display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
            See it in your portfolio
          </button>
          {!inline && (
            <button className="btn btn-primary btn-md" onClick={() => go("chat")}>
              Back to chat
            </button>
          )}
        </div>
      </div>
    );
    return (
      <Frame mount={mount} backLabel={chrome.backLabel} onBack={onBack}>
        {receipt}
      </Frame>
    );
  }

  const depositQuoteStep: PreviewRowStatus =
    preview.quoteStatus === "ok" ? "ok" : preview.quoteStatus === "error" || preview.wouldBreach ? "error" : "loading";
  const previewStep: PreviewRowStatus =
    preview.previewStatus === "ok" ? "ok" : preview.previewStatus === "error" ? "error" : "loading";

  return (
    <Frame mount={mount} backLabel={chrome.backLabel} onBack={onBack}>
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: inline ? 16 : 17, fontWeight: 600 }}>{chrome.title}</div>
          <Icon name="flask" size={18} />
        </div>
        <div style={{ fontSize: inline ? 13 : 13.5, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>
          {onchain.sub}
        </div>
      </div>

      {/* Live pre-sign check — REAL agent quote + on-chain eth_call preview. */}
      <div className="cf-sec">
        <div className="cf-lbl">{copy.simLabel}</div>
        <div>
          {intent === "deposit" && (
            <PreviewStep
              status={depositQuoteStep}
              loading="Checking policy & caps with Sparky"
              done="Policy & caps checked"
              error="Couldn't verify with Sparky"
            />
          )}
          <PreviewStep
            status={previewStep}
            loading={intent === "deposit" ? "Simulating on-chain (ERC-4626)" : "Simulating your redemption (ERC-4626)"}
            done={intent === "deposit" ? "Simulated on-chain" : "Redemption simulated"}
            error="On-chain preview failed"
          />
          {showReveal && (
            <div className="simbar pass">
              <Icon name="check" size={16} /> Preview passed — verified on-chain.
            </div>
          )}
          {previewError && !busy && (
            <div
              className="simbar"
              style={{
                color: "var(--loss)",
                background: "var(--loss-subtle, color-mix(in srgb,var(--loss) 12%,transparent))",
                borderColor: "color-mix(in srgb,var(--loss) 30%,transparent)",
              }}
            >
              <Icon name="alert" size={16} /> {preview.error ?? "Couldn't verify this transaction."} Nothing to sign.
            </div>
          )}
        </div>
      </div>

      {showReveal && (
        <>
          <div className="cf-sec cf-reveal" style={{ animationDelay: "0ms" }}>
            <div className="cf-lbl">Balance changes (on-chain preview)</div>
            {onchain.bc.map((r, k) => (
              <div className="bc-row" key={k}>
                <span className="muted">{r[0]}</span>
                <span className="tnum" style={r[2] ? { color: `var(${r[2]})` } : undefined}>
                  {r[1]}
                </span>
              </div>
            ))}
          </div>

          <div className={"cf-sec cf-reveal" + (shake ? " shake" : "")} style={{ animationDelay: "120ms" }}>
            <div className="cf-lbl">Guardrail checklist</div>
            {onchain.guards.map((g, k) => (
              <div className="guard pass" key={k}>
                {GUARD_ICON}
                <span className="gt">{g}</span>
              </div>
            ))}
            {copy.ack && (
              <div className="ackbox">
                <div
                  className={"ackcheck" + (acked ? " on" : "")}
                  onClick={() => setAcked((v) => !v)}
                  role="checkbox"
                  aria-checked={acked}
                >
                  <Icon name="check" size={13} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Requires your acknowledgement</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{copy.ack}</div>
                  <div style={{ fontSize: 12, color: "var(--caution)", marginTop: 6, fontWeight: 600 }}>
                    I understand this is above my usual buffer.
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="cf-sec cf-reveal" style={{ animationDelay: "240ms" }}>
            <div
              style={{
                display: "flex",
                gap: 9,
                alignItems: "flex-start",
                fontSize: 13,
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
              }}
            >
              <Icon name="shieldcheck" size={16} />
              {copy.ctrl}
            </div>
          </div>
        </>
      )}

      <div className="cf-sec cf-reveal" style={{ animationDelay: "360ms" }}>
        {showReveal && copy.ack && (
          <div style={{ fontSize: 12, color: "var(--caution)", marginBottom: 10, display: acked ? "none" : "block" }}>
            <Icon name="alert" size={13} /> Acknowledge the item above to enable signing.
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {cancelled ? null : (
            <button
              className={"btn btn-outline " + (inline ? "btn-md" : "btn-lg")}
              style={{ flex: "none" }}
              onClick={() => {
                if (inline) {
                  setCancelled(true);
                  toast("Cancelled — nothing moved.");
                } else {
                  go(chrome.cancelRoute);
                }
              }}
            >
              Cancel
            </button>
          )}
          {/* FAIL CLOSED: Sign appears ONLY once the live preview is verified. */}
          {showReveal && (
            <button
              className={"btn btn-primary " + (inline ? "btn-md" : "btn-lg")}
              style={{ flex: 1, ...(cancelled ? { opacity: 0.5 } : null) }}
              disabled={signDisabled}
              onClick={onSign}
            >
              {busy ? (
                <>
                  <span className="ai-dot" style={{ background: "var(--primary-foreground)" }} /> {exec.label}
                </>
              ) : (
                <>
                  <Icon name="key" size={16} /> {copy.signLabel}
                </>
              )}
            </button>
          )}
          {!showReveal && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12.5,
                color: "var(--muted-foreground)",
              }}
            >
              {previewError ? "Signing unavailable — see above." : "Verifying on-chain…"}
            </div>
          )}
        </div>
        {exec.error && (
          <div style={{ fontSize: 12, color: "var(--loss)", marginTop: 10 }}>
            <Icon name="alert" size={13} /> {exec.error}
          </div>
        )}
      </div>
    </Frame>
  );
}

/* ── the HONEST placeholder (no onchain execution) ───────────────────────────── */

/** Copy for the non-signable placeholder — truthful about what is / isn't live. */
function placeholderBody(intent: ConfirmIntent, go: (r: string) => void): React.ReactNode {
  if (intent === "deposit" || intent === "withdraw") {
    const route = intent === "deposit" ? "vault/deposit" : "vault/withdraw";
    const verb = intent === "deposit" ? "Deposit" : "Withdraw";
    return (
      <>
        <p style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6, margin: "0 0 14px" }}>
          {verb}s happen in the Vault, where the amount, the live on-chain preview, and your guardrails are shown before
          you sign. Nothing is signed here.
        </p>
        <button className="btn btn-primary btn-md" onClick={() => go(route)}>
          Open the Vault
        </button>
      </>
    );
  }
  const label = intent === "swap" ? "Swaps" : intent === "bridge" ? "Bridging" : "Premium payments";
  return (
    <>
      <p style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.6, margin: "0 0 6px" }}>
        {label} aren&rsquo;t live in this build yet. Sparky only proposes — <b>nothing is signed and nothing moves</b>.
        On-chain execution ships at launch.
      </p>
      <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.6, margin: "0 0 14px" }}>
        Your funds stay in your wallet. When it&rsquo;s live, you&rsquo;ll review every change and sign it yourself.
      </p>
    </>
  );
}

function PlaceholderConfirm({ intent, mount }: { intent: ConfirmIntent; mount: Mount }) {
  const router = useRouter();
  const chrome = chromeFor(intent);
  const inline = mount === "inline";
  const go = (route: string) => router.push(toHref(route));
  const onBack = () => (chrome.backRoute === "history" ? router.back() : go(chrome.backRoute));

  return (
    <Frame mount={mount} backLabel={chrome.backLabel} onBack={onBack}>
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: inline ? 16 : 17, fontWeight: 600 }}>{chrome.title}</div>
          <span className="badge" style={{ color: "var(--muted-foreground)" }}>
            Preview build
          </span>
        </div>
      </div>
      <div className="cf-sec">{placeholderBody(intent, go)}</div>
    </Frame>
  );
}

/* ── shared chrome ───────────────────────────────────────────────────────────── */

/** The route mount adds a Back link + `.cf-wrap`; the inline mount renders a bare card. */
function Frame({
  mount,
  backLabel,
  onBack,
  children,
}: {
  mount: Mount;
  backLabel: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  if (mount === "inline") {
    return (
      <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
        {children}
      </div>
    );
  }
  return (
    <div className="cf-wrap">
      <a className="qlink" style={{ display: "inline-flex", marginBottom: 14, cursor: "pointer" }} onClick={onBack}>
        <Icon name="chevr" size={15} /> {backLabel}
      </a>
      <div className="cf-card">{children}</div>
    </div>
  );
}
