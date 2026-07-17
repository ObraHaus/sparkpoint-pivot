"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { useNetwork } from "@/lib/network";
import { useSession } from "@/lib/auth/useSiwe";
import { toHref } from "@/lib/nav";

/** Real deployed Base-Sepolia addresses (SoT) — no fabricated address on any trust surface. */
const _DEPLOYED = getAddresses(84532);
const _shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

type MenuKind = "wallet" | "network" | "avatar";
type SheetKind = "proveit" | "notifications";
type OverlayKind = MenuKind | SheetKind | "cmdk";

interface AnchorRect {
  bottom: number;
  right: number;
}
interface OverlayState {
  kind: OverlayKind;
  anchor?: AnchorRect;
}
interface ToastItem {
  id: number;
  msg: string;
  linkText?: string;
  linkFn?: () => void;
}

interface OverlayApi {
  openProveIt: () => void;
  openWalletMenu: (e: React.MouseEvent) => void;
  openNetworkMenu: (e: React.MouseEvent) => void;
  openNotifications: () => void;
  openCommandPalette: () => void;
  openAvatarMenu: (e: React.MouseEvent) => void;
  toast: (msg: string, linkText?: string, linkFn?: () => void) => void;
}

const OverlayContext = createContext<OverlayApi | null>(null);

function anchorOf(e: React.MouseEvent): AnchorRect {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return { bottom: r.bottom, right: r.right };
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // SSR-safe client-only flag for the portal (no set-state-in-effect).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [current, setCurrent] = useState<OverlayState | null>(null);
  const [visible, setVisible] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const open = useCallback((state: OverlayState) => {
    setCurrent(state);
    requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    window.setTimeout(() => setCurrent(null), 260);
  }, []);

  const toast = useCallback((msg: string, linkText?: string, linkFn?: () => void) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, linkText, linkFn }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const go = useCallback(
    (route: string) => {
      close();
      router.push(toHref(route));
    },
    [close, router],
  );

  const api = useMemo<OverlayApi>(
    () => ({
      openProveIt: () => open({ kind: "proveit" }),
      openWalletMenu: (e) => open({ kind: "wallet", anchor: anchorOf(e) }),
      openNetworkMenu: (e) => open({ kind: "network", anchor: anchorOf(e) }),
      openNotifications: () => open({ kind: "notifications" }),
      openCommandPalette: () => open({ kind: "cmdk" }),
      openAvatarMenu: (e) => open({ kind: "avatar", anchor: anchorOf(e) }),
      toast,
    }),
    [open, toast],
  );

  // ⌘K / Esc keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open({ kind: "cmdk" });
      }
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <OverlayContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <>
            {current && (
              <Scrim show={visible} onClose={close}>
                {(current.kind === "proveit" || current.kind === "notifications") && (
                  <Sheet
                    show={visible}
                    onClose={close}
                    title={current.kind === "proveit" ? "What Sparky can & can't do" : "Notifications"}
                    footer={
                      current.kind === "proveit" ? (
                        <button className="btn btn-primary btn-md" style={{ width: "100%" }} onClick={() => go("trust/permissions")}>
                          See exact on-chain permissions
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-md" style={{ width: "100%" }} onClick={() => go("notifications")}>
                          Open notifications
                        </button>
                      )
                    }
                  >
                    {current.kind === "proveit" ? <ProveItBody go={go} /> : <NotificationsBody />}
                  </Sheet>
                )}

                {current.kind === "cmdk" && <CommandPalette show={visible} onClose={close} go={go} />}

                {(current.kind === "wallet" || current.kind === "network" || current.kind === "avatar") && current.anchor && (
                  <Menu show={visible} anchor={current.anchor}>
                    {current.kind === "wallet" && <WalletMenu go={go} toast={toast} close={close} />}
                    {current.kind === "network" && <NetworkMenu go={go} toast={toast} close={close} />}
                    {current.kind === "avatar" && <AvatarMenu go={go} toast={toast} />}
                  </Menu>
                )}
              </Scrim>
            )}
            <div className="toasts">
              {toasts.map((t) => (
                <div key={t.id} className="toast">
                  <span style={{ color: "var(--gain)" }}>
                    <Icon name="check" size={16} />
                  </span>
                  <span style={{ flex: 1 }}>{t.msg}</span>
                  {t.linkText && <a onClick={t.linkFn}>{t.linkText}</a>}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </OverlayContext.Provider>
  );
}

export function useOverlay(): OverlayApi {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error("useOverlay must be used within an OverlayProvider");
  return ctx;
}

/* ------------------------------- primitives ------------------------------- */

function Scrim({ show, onClose, children }: { show: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className={"scrim" + (show ? " show" : "")} onClick={onClose} />
      {children}
    </>
  );
}

function Sheet({
  show,
  onClose,
  title,
  footer,
  children,
}: {
  show: boolean;
  onClose: () => void;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={"sheet" + (show ? " show" : "")} role="dialog" aria-label={title}>
      <div className="sheet-hd">
        <span className="t">{title}</span>
        <button className="iconbtn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="sheet-bd">{children}</div>
      {footer && <div className="sheet-ft">{footer}</div>}
    </div>
  );
}

function Menu({ show, anchor, children }: { show: boolean; anchor: AnchorRect; children: ReactNode }) {
  const right = typeof window !== "undefined" ? Math.max(12, window.innerWidth - anchor.right) : 12;
  return (
    <div
      className={"menu" + (show ? " show" : "")}
      style={{ position: "fixed", top: anchor.bottom + 8, right, zIndex: 100, minWidth: 220 }}
    >
      {children}
    </div>
  );
}

/* ------------------------------- content ------------------------------- */

function ProveItBody({ go }: { go: (r: string) => void }) {
  const sk = data.sessionKey;
  const rows: [string, string, string, string, string?, string?][] = [
    ["shieldcheck", "--gain", "No admin withdrawal", "We have no code path to send your funds anywhere but back to you — not us, not anyone."],
    ["door", "--gain", "Withdraw anytime", "Exit directly on-chain, even if Sparky's app and AI are completely offline.", "Withdraw now", "trust/exit"],
    ["key", "--gain", "You own your keys", "You own your keys and your account. We never generate a wallet for you or hold your keys."],
    ["zap", "--caution", "Scoped, revocable automation", sk ? "1 active session key — scoped, capped, time-limited." : "No automation granted. Any you grant is instantly revocable by you.", sk ? "Manage" : "Set up", "automation"],
    ["pause", "--gain", "Non-upgradeable, pause-only", "The vault is single-purpose and non-upgradeable. Any pause control governs pausing only — never your funds."],
  ];
  return (
    <>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5, margin: "0 0 14px" }}>
        These five guarantees are structural — provable from the contracts, not promised. Each links to its on-chain evidence.
      </p>
      <div className="cancan">
        <div className="col can">
          <h5>Can</h5>
          <ul>
            {["Direct strategy", "Suggest moves", "Simulate", "Pause new deposits"].map((x) => (
              <li key={x}>
                <Icon name="check" size={13} />
                {x}
              </li>
            ))}
          </ul>
        </div>
        <div className="col cant">
          <h5>Can&apos;t</h5>
          <ul>
            {["Move your funds", "Withdraw to itself", "Change the rules", "Stop you withdrawing"].map((x) => (
              <li key={x}>
                <Icon name="x" size={13} />
                {x}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div style={{ marginTop: 6 }}>
        {rows.map((r) => (
          <div className="proveitem" key={r[2]}>
            <span className="pi-ico" style={{ background: `var(${r[1]}-subtle)`, color: `var(${r[1]})` }}>
              <Icon name={r[0]} size={17} />
            </span>
            <div style={{ flex: 1 }}>
              <div className="pi-t">{r[2]}</div>
              <div className="pi-d">{r[3]}</div>
              {r[4] && (
                <button
                  className={"btn btn-sm " + (r[4] === "Withdraw now" ? "btn-outline" : "btn-ghost")}
                  style={{ marginTop: 8 }}
                  onClick={() => go(r[5]!)}
                >
                  {r[4]}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div
        className="mono"
        style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}
      >
        Vault {_shortAddr(_DEPLOYED.vault)} · Caps {_shortAddr(_DEPLOYED.capRegistry)} · <Icon name="ext" size={11} /> View all permissions
      </div>
    </>
  );
}

function NotificationsBody() {
  return (
    <>
      {data.notifications.map((n, i) => (
        <div className="proveitem" key={i} style={{ opacity: n.unread ? 1 : 0.7 }}>
          <span className="pi-ico" style={{ background: "var(--spark-subtle)", color: "var(--primary)" }}>
            <Icon name={n.icon} size={16} />
          </span>
          <div style={{ flex: 1 }}>
            <div className="pi-t">
              {n.t}
              {n.unread && (
                <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--primary)", verticalAlign: "middle", marginLeft: 4 }} />
              )}
            </div>
            <div className="pi-d">{n.s}</div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>{n.time}</div>
          </div>
        </div>
      ))}
    </>
  );
}

function MenuHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-soft)" }}>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{title}</div>
      <div className="mono" style={{ fontSize: 13, marginTop: 3 }}>
        {sub}
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, style }: { icon: string; label: ReactNode; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button className="menu-item" onClick={onClick} style={style}>
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}

function WalletMenu({ go, toast, close }: { go: (r: string) => void; toast: (m: string) => void; close: () => void }) {
  const { wallet, network, address, explorerBase, isConnected, disconnectWallet } = useNetwork();

  const copyAddress = () => {
    close();
    if (!address) return toast("No wallet connected");
    navigator.clipboard
      ?.writeText(address)
      .then(() => toast("Address copied"))
      .catch(() => toast("Couldn't copy address"));
  };
  const viewOnExplorer = () => {
    close();
    if (!address) return toast("No wallet connected");
    window.open(`${explorerBase}/address/${address}`, "_blank", "noopener,noreferrer");
  };
  // §B3: the explorer differs by chain (Basescan on Base; Blockscout on Robinhood testnet) — name it
  // honestly from the active explorer host rather than hardcoding "Basescan".
  const explorerName = /basescan\./i.test(explorerBase) ? "Basescan" : "explorer";
  const disconnect = async () => {
    close();
    await disconnectWallet();
    go("landing");
  };

  return (
    <>
      <MenuHeader title={isConnected ? `Connected · ${network.name}` : "Not connected"} sub={wallet} />
      <MenuItem icon="copy" label="Copy address" onClick={copyAddress} />
      <MenuItem icon="ext" label={`View on ${explorerName}`} onClick={viewOnExplorer} />
      <MenuItem icon="shieldcheck" label="View exact permissions" onClick={() => go("trust/permissions")} />
      <MenuItem icon="logout" label="Disconnect" onClick={disconnect} />
    </>
  );
}

function NetworkMenu({ go, close }: { go: (r: string) => void; toast: (m: string) => void; close: () => void }) {
  // §B3 multi-network: offer the real switchable testnet chains (Base Sepolia + Robinhood Testnet)
  // and switch by chainId. A single switchChain() also adds the chain to the wallet when unknown,
  // so a user can actually get ONTO Robinhood testnet from here (not just be recognized on it).
  const { switchableNetworks, chainId, switchToChain } = useNetwork();
  return (
    <>
      <div style={{ padding: "9px 12px 7px", fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase" }}>
        Network
      </div>
      {switchableNetworks.map((n) => {
        const active = chainId === n.chainId;
        const onClick = () => {
          close();
          if (!active) switchToChain(n.chainId);
        };
        return (
          <button key={n.chainId} className="menu-item" onClick={onClick} style={!n.live ? { opacity: 0.7 } : undefined}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: n.color, flex: "none" }} />
            {n.name}
            {active ? (
              <span style={{ marginLeft: "auto", color: "var(--primary)" }}>
                <Icon name="check" size={15} />
              </span>
            ) : (
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--caution)" }}>switch</span>
            )}
          </button>
        );
      })}
      <div style={{ padding: "8px 12px 4px", borderTop: "1px solid var(--border-soft)", marginTop: 4 }}>
        <MenuItem icon="refresh" label="Bridge assets between networks" onClick={() => go("bridge")} style={{ color: "var(--primary)" }} />
      </div>
    </>
  );
}

function AvatarMenu({ go, toast }: { go: (r: string) => void; toast: (m: string) => void }) {
  const { wallet, disconnectWallet } = useNetwork();
  const { session } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  return (
    <>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-soft)" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Sparky user</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>
          {wallet}
        </div>
      </div>
      <MenuItem icon="user" label="Account" onClick={() => go("settings/account")} />
      <MenuItem icon="settings" label="Settings" onClick={() => go("settings")} />
      <MenuItem icon="sliders" label="Mandate" onClick={() => go("settings")} />
      <MenuItem icon="book" label="Learn" onClick={() => go("learn")} />
      {/* Only admins see the admin entry — for everyone else the surface is a 404 (invisible). */}
      {session?.admin && <MenuItem icon="grid" label="Admin panel" onClick={() => go("admin")} />}
      <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 6px 4px" }} />
      <button
        className="menu-item"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const next = isLight ? "dark" : "light";
          setTheme(next);
          toast(next === "light" ? "Light mode on" : "Dark mode on");
        }}
      >
        <Icon name={isLight ? "sun" : "moon"} size={16} />
        <span>{isLight ? "Light mode" : "Dark mode"}</span>
        <span className={"switch" + (isLight ? " on" : "")} style={{ marginLeft: "auto" }} />
      </button>
      <div style={{ borderTop: "1px solid var(--border-soft)", margin: "4px 6px" }} />
      <MenuItem icon="logout" label="Log out" onClick={async () => { await disconnectWallet(); go("landing"); }} />
    </>
  );
}

const CMDK_ACTIONS: [string, string, string][] = [
  ["Withdraw now", "door", "trust/exit"],
  ["Prove it — permissions", "shieldcheck", "trust/permissions"],
  ["Go to Chat", "chat", "chat"],
  ["Open Portfolio", "portfolio", "portfolio"],
  ["Open Vault", "vault", "vault"],
  ["Swap tokens", "swap", "swap"],
  ["Bridge Base ↔ Sui", "refresh", "bridge"],
  ["Fees / how we make money", "coins", "fees"],
  ["Premium", "zap", "premium"],
  ["Strategies", "strategies", "strategies"],
  ["Trust Center", "shieldcheck", "trust"],
  ["Revoke automation", "zap", "automation"],
  ["Outcome Log", "activity", "outcomes"],
  ["Settings", "settings", "settings"],
];

function CommandPalette({ show, onClose, go }: { show: boolean; onClose: () => void; go: (r: string) => void }) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);
  const matches = CMDK_ACTIONS.filter((a) => a[0].toLowerCase().includes(q.toLowerCase()));
  return (
    <div className={"dialog" + (show ? " show" : "")} role="dialog" aria-label="Command palette">
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border-soft)" }}>
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search actions, screens…"
          style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--foreground)", fontSize: 15, fontFamily: "inherit" }}
        />
        <span className="kbd" onClick={onClose} style={{ cursor: "pointer" }}>
          esc
        </span>
      </div>
      <div style={{ maxHeight: 340, overflow: "auto", padding: 8 }}>
        {matches.length ? (
          matches.map((a) => (
            <button key={a[2]} className="menu-item" style={{ width: "100%" }} onClick={() => go(a[2])}>
              <Icon name={a[1]} size={16} />
              {a[0]}
            </button>
          ))
        ) : (
          <div style={{ padding: 14, color: "var(--muted-foreground)", fontSize: 13 }}>No matches</div>
        )}
      </div>
    </div>
  );
}
