"use client";

/**
 * /automation/grant — Grant scoped access, LIVE (US6). You decide the scope, caps, and expiry; the
 * server materializes an OWNER-signed grant transaction which you sign from your own wallet. The
 * session keypair is generated CLIENT-SIDE — only its PUBLIC address is ever sent to the service, so
 * SparkPoint never holds the session private key (N1/N3). Granting is revocable at any time.
 *
 * De-mocked from the design's `automation/grant` screen: the inputs are controlled, "Review & sign
 * grant" builds a REAL grant via POST /session-keys/grant/build, and on `ok` the server-echoed scope
 * is shown VERBATIM before you sign the returned tx. On `ok:false` the policy reasons are shown
 * honestly and there is no signable path (fail-closed).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSignMessage } from "wagmi";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/trust.css";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import {
  useGrantBuilder,
  useSessionKeyTx,
  useInvalidateSessionKeys,
  type GrantScopeEcho,
} from "@/lib/automation/useSessionKey";
import {
  cacheUnlockKey,
  deriveUnlockKey,
  putSessionKey,
  unlockMessage,
  type KeyScope,
} from "@/lib/automation/sessionKeyStore";
import {
  bpsToPercent,
  formatUsdcBaseUnits,
  percentToBps,
  selectorLabel,
  usdcToBaseUnits,
  validUntilFromDays,
  vaultAllowlist,
} from "@/lib/automation/scope";

const VAULT_CHAIN = 84532;
const EXPIRES: { label: string; days: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

export default function Page() {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [perTx, setPerTx] = useState("$1,000");
  const [cumulative, setCumulative] = useState("$5,000");
  const [slippage, setSlippage] = useState("0.5%");
  const [expiry, setExpiry] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  // The session PRIVATE key stays in the browser — only the address crosses to the service (N1/N3).
  // Held in memory through the grant flow; after the grant CONFIRMS the user can encrypt + persist it
  // on this device (one unlock signature) so hands-off moves can sign later — see `onEnableHandsOff`.
  const [sessionPk, setSessionPk] = useState<Hex | null>(null);
  const [handsOff, setHandsOff] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [handsOffError, setHandsOffError] = useState<string | null>(null);

  const grant = useGrantBuilder();
  const tx = useSessionKeyTx();
  const invalidate = useInvalidateSessionKeys();
  const { signMessageAsync } = useSignMessage();
  useHoldCriticalOp(tx.isBusy, "locked");
  useEffect(() => {
    if (tx.isDone) invalidate();
  }, [tx.isDone, invalidate]);

  // Encrypt + persist the freshly-granted session key on THIS device (option A, operator-chosen): the
  // user signs a fixed NON-transactional unlock message once → HKDF → AES-GCM key → store. The private
  // key never leaves the device (N3); a stolen snapshot alone can't decrypt without the wallet re-sign.
  async function onEnableHandsOff() {
    const smartAccount = grant.result?.tx?.to;
    if (!sessionPk || !smartAccount) {
      setHandsOffError("The session key isn’t available — re-grant to enable hands-off signing.");
      setHandsOff("error");
      return;
    }
    setHandsOffError(null);
    setHandsOff("saving");
    try {
      const signature = await signMessageAsync({ message: unlockMessage(smartAccount, VAULT_CHAIN) });
      const unlockKey = await deriveUnlockKey(signature);
      cacheUnlockKey(smartAccount, VAULT_CHAIN, unlockKey);
      const scope: KeyScope = {
        chainId: VAULT_CHAIN,
        account: smartAccount,
        sessionAddress: privateKeyToAccount(sessionPk).address,
      };
      const ok = await putSessionKey(scope, sessionPk, unlockKey);
      if (!ok) throw new Error("This browser can’t store the key securely (private mode?).");
      setSessionPk(null); // drop the in-memory copy — it now lives only encrypted at rest
      setHandsOff("done");
    } catch (e) {
      setHandsOffError(e instanceof Error ? e.message : "Couldn’t enable hands-off signing.");
      setHandsOff("error");
    }
  }

  const vault = (() => {
    try {
      return getAddresses(VAULT_CHAIN).vault;
    } catch {
      return undefined;
    }
  })();

  async function onBuild() {
    setFormError(null);
    const perTxBase = usdcToBaseUnits(perTx);
    const cumBase = usdcToBaseUnits(cumulative);
    const bps = percentToBps(slippage);
    const allowlist = on ? vaultAllowlist(vault) : [];
    if (!perTxBase) return setFormError("Enter a per-transaction cap greater than $0.");
    if (!cumBase) return setFormError("Enter a cumulative cap greater than $0.");
    if (bps === null) return setFormError("Enter a max slippage between 0% and 100%.");
    if (allowlist.length === 0) {
      return setFormError(
        vault ? "Turn on a scope — a key with nothing allowed can’t be granted." : "The vault isn’t available on this network.",
      );
    }
    // Fresh client-side keypair. Only the PUBLIC address is sent; the private key never leaves here.
    const pk = generatePrivateKey();
    const sessionAddress = privateKeyToAccount(pk).address;
    setSessionPk(pk);
    await grant.build({
      sessionPubkey: sessionAddress,
      validUntil: validUntilFromDays(EXPIRES[expiry].days, Date.now()),
      validAfter: 0,
      perTxCap: perTxBase,
      cumulativeCap: cumBase,
      maxSlippageBps: bps,
      allowlist,
    });
  }

  // Done → success. Built-ok → review + sign. Otherwise → the form (with any honest reasons/error).
  if (tx.isDone) {
    return (
      <Frame router={router}>
        <div className="card card-pad">
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--gain)", fontWeight: 600, fontSize: 15 }}>
            <Icon name="check" size={18} /> Session key granted &amp; confirmed on-chain.
          </div>
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.5 }}>
            In-scope moves can now execute under these on-chain limits, and each still appears in your outcome log.
            You can revoke instantly at any time.
          </div>
          {tx.txHash && (
            <div style={{ fontSize: 12.5, marginTop: 10 }}>
              <a href={`https://sepolia.basescan.org/tx/${tx.txHash}`} target="_blank" rel="noreferrer" style={{ color: "var(--info)" }}>
                View grant transaction ↗
              </a>
            </div>
          )}

          {/* Optional hands-off enablement: encrypt + store the session key on THIS device (N3). */}
          {handsOff !== "done" ? (
            <div
              style={{
                marginTop: 16,
                padding: 13,
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                background: "var(--info-subtle)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>Turn on hands-off moves (optional)</div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>
                Store your automation key <strong>encrypted</strong> in this browser so approved, in-scope moves can run
                without a wallet prompt. You’ll sign once to unlock it — that authorizes no move, and the key never leaves
                your device. Skip this and every move stays manual (you sign each one).
              </div>
              {handsOffError && (
                <div style={{ fontSize: 12, color: "var(--loss)", marginTop: 8 }}>{handsOffError}</div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  className="btn btn-primary btn-md"
                  disabled={handsOff === "saving" || !sessionPk}
                  onClick={() => void onEnableHandsOff()}
                >
                  {handsOff === "saving" ? "Sign to unlock…" : "Enable on this device"}
                </button>
                <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("automation"))}>
                  Not now
                </button>
              </div>
              {!sessionPk && handsOff !== "saving" && (
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8 }}>
                  The key is only held during this grant — re-grant here to enable hands-off later.
                </div>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 8, color: "var(--gain)", fontSize: 13 }}>
              <Icon name="check" size={16} /> Hands-off signing is on for this browser.
            </div>
          )}

          <button className="btn btn-primary btn-md" style={{ marginTop: 16 }} onClick={() => router.push(toHref("automation"))}>
            Manage automation
          </button>
        </div>
      </Frame>
    );
  }

  const built = grant.result;
  if (built?.ok && built.scopeEcho && built.tx) {
    return (
      <Frame router={router}>
        <ReviewCard
          scope={built.scopeEcho}
          policyVersion={built.policyVersion}
          signing={tx.stage === "signing"}
          confirming={tx.stage === "confirming"}
          busy={tx.isBusy}
          error={tx.error}
          onSign={() => tx.send(built.tx!)}
          onEdit={() => grant.reset()}
        />
      </Frame>
    );
  }

  return (
    <Frame router={router}>
      <div className="card card-pad">
        <div className="field" style={{ marginBottom: 18 }}>
          <label>What it can do</label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
            }}
          >
            <span style={{ fontSize: 13.5 }}>Auto-rebalance within the Aave vault only</span>
            <button className={"switch" + (on ? " on" : "")} onClick={() => setOn((v) => !v)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>Per-transaction cap</label>
          <input className="input" value={perTx} onChange={(e) => setPerTx(e.target.value)} inputMode="decimal" />
          <div className="hint">Maximum the session key can move in a single action.</div>
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>Cumulative cap</label>
          <input className="input" value={cumulative} onChange={(e) => setCumulative(e.target.value)} inputMode="decimal" />
          <div className="hint">Total the session key can move before it stops.</div>
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>Max slippage</label>
          <input className="input" value={slippage} onChange={(e) => setSlippage(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label>Expires</label>
          <div className="seg" style={{ width: "100%" }}>
            {EXPIRES.map((d, i) => (
              <button key={d.label} className={i === expiry ? "active" : ""} style={{ flex: 1 }} onClick={() => setExpiry(i)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            background: "var(--info-subtle)",
            border: "1px solid color-mix(in srgb,var(--info) 22%,transparent)",
            borderRadius: "var(--radius)",
            padding: 13,
            fontSize: 12.5,
            color: "var(--muted-foreground)",
            lineHeight: 1.5,
            marginBottom: 16,
          }}
        >
          <Icon name="info" size={14} /> Granting a session key is itself a transaction you sign. In-scope actions then
          execute under these on-chain limits; each still appears in your outcome log. The session key is generated on
          your device — SparkPoint never holds it.
        </div>

        {formError && <div style={{ fontSize: 12.5, color: "var(--loss)", marginBottom: 12 }}>{formError}</div>}

        {built && !built.ok && (
          <div
            style={{
              border: "1px solid color-mix(in srgb, var(--loss) 30%, transparent)",
              background: "color-mix(in srgb, var(--loss) 8%, transparent)",
              borderRadius: "var(--radius)",
              padding: 13,
              marginBottom: 12,
            }}
          >
            <div style={{ color: "var(--loss)", fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="alert" size={15} /> This grant can’t be issued as scoped.
            </div>
            {built.reasons.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--muted-foreground)", fontSize: 12.5 }}>
                {built.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {grant.error && (
          <div style={{ fontSize: 12.5, color: "var(--loss)", marginBottom: 12 }}>{grant.error.message}</div>
        )}

        <button className="btn btn-primary btn-lg" style={{ width: "100%" }} disabled={grant.building} onClick={() => void onBuild()}>
          {grant.building ? "Building grant…" : "Review & sign grant"}
        </button>
      </div>
    </Frame>
  );
}

function Frame({ router, children }: { router: ReturnType<typeof useRouter>; children: React.ReactNode }) {
  return (
    <div className="page page-narrow">
      <a className="qlink" style={{ display: "inline-flex", marginBottom: 14 }} onClick={() => router.push(toHref("automation"))}>
        <Icon name="chevr" size={15} /> Back
      </a>
      <div className="pagehead">
        <div>
          <h1>Grant scoped access</h1>
          <div className="sub">You decide the scope, caps, and expiry. Revoke anytime.</div>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The server-echoed scope, shown VERBATIM for review before the user signs the grant tx. */
function ReviewCard({
  scope,
  policyVersion,
  signing,
  confirming,
  busy,
  error,
  onSign,
  onEdit,
}: {
  scope: GrantScopeEcho;
  policyVersion?: string;
  signing: boolean;
  confirming: boolean;
  busy: boolean;
  error?: string;
  onSign: () => void;
  onEdit: () => void;
}) {
  const validUntilLabel = scope.validUntil ? new Date(scope.validUntil * 1000).toLocaleString() : "—";
  const rows: [string, React.ReactNode][] = [
    ["Session key", <span className="mono" style={{ fontSize: 11.5 }} key="sk">{short(scope.sessionKey)}</span>],
    ["Per-transaction cap", formatUsdcBaseUnits(scope.perTxCap)],
    ["Cumulative cap", formatUsdcBaseUnits(scope.cumulativeCap)],
    ["Max slippage", bpsToPercent(scope.maxSlippageBps)],
    ["Valid until", validUntilLabel],
  ];
  if (scope.recipientPin) rows.push(["Recipient pinned to", <span className="mono" style={{ fontSize: 11.5 }} key="rp">{short(scope.recipientPin)}</span>]);
  rows.push(["Revocable", scope.revocable === false ? "no" : "yes — instantly, by you"]);

  return (
    <div className="card card-pad">
      <div className="card-hd">
        <span className="t">Review the scope you’re granting</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginBottom: 12, lineHeight: 1.5 }}>
        This is exactly what the on-chain policy will register. Nothing moves until you sign — and you can revoke it at
        any time.
      </div>

      <div style={{ marginBottom: 10 }}>
        {rows.map(([label, value]) => (
          <div className="statusrow" key={label}>
            <span style={{ fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 13, textAlign: "right" }}>{value}</span>
          </div>
        ))}
      </div>

      <div className="cf-lbl" style={{ marginBottom: 4, fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>
        Allowlist
      </div>
      {scope.allowlist.length > 0 ? (
        scope.allowlist.map((e, i) => (
          <div key={i} className="statusrow" style={{ fontSize: 12.5 }}>
            <span className="mono" style={{ fontSize: 11.5 }}>{short(e.target)}</span>
            <span>{selectorLabel(e.selector)}</span>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>— none —</div>
      )}

      {policyVersion && (
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 10 }}>Policy {policyVersion}</div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button className="btn btn-outline btn-md" disabled={busy} onClick={onEdit}>
          Edit
        </button>
        <button className="btn btn-primary btn-md" style={{ flex: 1 }} disabled={busy} onClick={onSign}>
          {signing ? "Confirm in your wallet…" : confirming ? "Confirming on-chain…" : "Sign grant"}
        </button>
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--loss)" }}>{error}</div>}
    </div>
  );
}
