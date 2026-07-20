"use client";

/**
 * /chat — the Chat AI assistant (primary hub).
 *
 * Faithful port of docs/design-handover/showcase/screens/chat.js. The assistant thread
 * with structured cards (recommendation / action / portfolio-snapshot / tip / outcome),
 * the tool-step "thinking" state, suggested-prompt chips, and the composer. A
 * chat-initiated deposit/swap/bridge renders <InlineConfirm> INLINE in the thread — the
 * chat screen's OWN confirm (chat.js's CONFIRM map), not the shared ConfirmFlow route
 * gate, so its copy/structure match chat.js exactly. Copy/markup match the source.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon, SparkMark } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money } from "@/lib/utils";
import { toHref } from "@/lib/nav";
import { RiskChip } from "@/components/ui/risk-chip";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import { useHoldCriticalOp } from "@/lib/ui/useCriticalOp";
import { ThinkingTurn, type ThinkStep } from "@/components/screens/chat/thinking";
import { InlineConfirm, type InlineIntent } from "@/components/screens/chat/inline-confirm";
import { LiveBlocks } from "@/components/screens/chat/live-blocks";
import {
  RecCard,
  SnapshotCard,
  TipCard,
  OutcomeCard,
  WalletCard,
  SwapCard,
  BridgeCard,
  CiteBody,
  type CardActions,
} from "@/components/screens/chat/cards";
import { useAgentClient, usePortfolioView } from "@/lib/agent/useAgent";
import { parseCard, type ChatCard } from "@/lib/agent/cards";
import { AgentApiError } from "@/lib/agent/client";
import { useAccount, useBalance } from "wagmi";
import { useVault } from "@/lib/chain/useVault";
import { derivePortfolio } from "@/lib/portfolio/derive";
import "@/components/screens/chat.css";

/** Read the deployed vault on Base Sepolia even before a wallet connects (mirrors portfolio/page). */
const CHAT_DISPLAY_CHAIN_ID = 84532;

type CardKind = "rec" | "snapshot" | "tip" | "outcome" | "wallet" | "swap" | "bridge";

/** A single rendered turn in the thread. */
type Turn =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "ai"; text: React.ReactNode; card?: CardKind }
  | { id: number; kind: "thinking"; steps: ThinkStep[]; then: () => void }
  | { id: number; kind: "inline"; intent: InlineIntent }
  // A LIVE `/chat` turn: streamed, fail-closed ChatBlocks from the agent service.
  | { id: number; kind: "live"; cards: ChatCard[]; streaming: boolean; error?: string };

const EMPTY_CHIPS = [
  "What's in my wallet?",
  "Find steady, lower-risk yield",
  "Put my idle USDC to work",
  "Swap ETH → USDC",
  "Bridge to Sui",
  "Is the Aave vault safe?",
  "Explain vault shares",
  "How do you keep my funds safe?",
];

let UID = 0;
const nextId = () => ++UID;

/** The primed first message after onboarding (chat.js render bootstrap). */
function primedThread(): Turn[] {
  return [
    {
      id: nextId(),
      kind: "ai",
      text: (
        <>
          Your plan: <b>lower risk (1/5)</b> — capital-preservation-first, steady USDC yield. Tell me what you&apos;d
          like to do, or try one of the suggestions below.
        </>
      ),
    },
  ];
}

/** The cold-start greeting (chat.js "New chat" handler). */
function coldThread(): Turn[] {
  return [
    {
      id: nextId(),
      kind: "ai",
      text: (
        <>
          Hi — I&apos;m Sparky&apos;s AI. Tell me your goal, or ask me anything about your wallet. I suggest; you
          approve and sign.
        </>
      ),
    },
  ];
}

export default function ChatPage() {
  const router = useRouter();
  const { toast } = useOverlay();
  const go = useCallback((route: string) => router.push(toHref(route)), [router]);

  // Live agent seam. `online` ⇒ base URL configured AND wallet connected; otherwise
  // every send falls back to the mock keyword router (graceful "assistant offline").
  const { client: agentClient, online } = useAgentClient();
  const convRef = useRef<string | undefined>(undefined);

  const [turns, setTurns] = useState<Turn[]>(primedThread);
  // First load shows the same starter suggestions as "New chat" (EMPTY_CHIPS).
  const [chips, setChips] = useState<string[]>(EMPTY_CHIPS);
  // Persisted per-wallet chat history (B1): the user's real saved threads.
  const [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // Feature 006: pause the force-refresh while a chat answer is streaming or an unsent draft exists
  // (BUSY — data loss, not funds). `streaming` is derived from the live turn's own flag.
  const streaming = turns.some((t) => t.kind === "live" && t.streaming);
  useHoldCriticalOp(streaming || draft.trim().length > 0, "busy");

  // The "Source" sheet opened by a citation chip (chat.js SP.openSheet('Source', …)).
  const [citeOpen, setCiteOpen] = useState(false);
  const [citeShow, setCiteShow] = useState(false);
  const openCite = useCallback(() => {
    setCiteOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setCiteShow(true)));
  }, []);
  const closeCite = useCallback(() => {
    setCiteShow(false);
    window.setTimeout(() => setCiteOpen(false), 260);
  }, []);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // client-only flag so the cite-sheet portal never runs during SSR (matches OverlayProvider).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Right-rail Portfolio card — LIVE direct-RPC reads (mirrors /portfolio), NEVER the mock figure.
  // Only the disconnected preview may show illustrative mock; every connected-but-not-live state
  // shows a dash + honest note. Unrealized PnL comes from the agent's flow index and only when
  // it's live and non-stale (avoids the phantom-PnL window flagged in the R5 audit).
  const { isConnected: railConnected } = useAccount();
  const railVault = useVault({ chainId: railConnected ? undefined : CHAT_DISPLAY_CHAIN_ID });
  const railEth = useBalance({
    address: railVault.account,
    query: { enabled: railConnected && !!railVault.account },
  });
  const railDerived = derivePortfolio({
    underlying: railVault.underlying,
    usdcBalance: railVault.usdcBalance,
    shares: railVault.shares,
    ethWei: railEth.data?.value,
  });
  const railWrongNetwork = railConnected && railVault.unavailable?.kind === "vault_not_deployed";
  const railLoading =
    railConnected && !railWrongNetwork && (railVault.isLoading || (railEth.isLoading && !!railVault.account));
  const railError = railConnected && !railWrongNetwork && !railLoading && railVault.isError;
  const railLive = railConnected && railVault.isDeployed && !railLoading && !railError && !railWrongNetwork;
  const railPreview = !railConnected;
  const railAgent = usePortfolioView();
  const railUnrealized = railLive && railAgent && !railAgent.stale ? railAgent.unrealizedUsd : undefined;
  const railNetWorth = railLoading
    ? "…"
    : railLive
      ? money(railDerived.totalUsd)
      : railPreview
        ? money(data.netWorth)
        : "—";

  const scrollDown = useCallback(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollDown();
  }, [turns, scrollDown]);

  const pushAi = useCallback((text: React.ReactNode, card?: CardKind) => {
    setTurns((t) => [...t, { id: nextId(), kind: "ai", text, card }]);
  }, []);
  const pushInline = useCallback((intent: InlineIntent) => {
    setTurns((t) => [...t, { id: nextId(), kind: "inline", intent }]);
  }, []);
  const think = useCallback((steps: ThinkStep[], then: () => void) => {
    setTurns((t) => [...t, { id: nextId(), kind: "thinking", steps, then }]);
  }, []);

  // ----- keyword router (respond) -----
  const respond = useCallback(
    (text: string) => {
      const q = text.toLowerCase();
      if (
        q.includes("bridge") ||
        q.includes("sui") ||
        q.includes("cross-chain") ||
        q.includes("cross chain") ||
        q.includes("other network") ||
        q.includes("move to")
      ) {
        think(
          [
            { a: "Reading balances on Base & Sui", b: "Read balances on Base & Sui" },
            { a: "Finding the canonical route", b: "Found the canonical route" },
          ],
          () => {
            pushAi(
              <>
                You can move assets between <b>Base</b> and <b>Sui</b> without giving up custody. Here&apos;s a bridge
                I&apos;d set up — you sign, funds land in your own wallet on the other side.
              </>,
              "bridge",
            );
            setChips(["Why bridge to Sui?", "Is bridging safe?", "Show my portfolio"]);
          },
        );
      } else if (q.includes("swap") || q.includes("convert") || (q.includes("eth") && q.includes("usdc"))) {
        think(
          [
            { a: "Reading your wallet", b: "Read your wallet" },
            { a: "Finding the best route on Base", b: "Found the best route on Base" },
            { a: "Checking slippage", b: "Checked slippage" },
          ],
          () => {
            pushAi(<>Here&apos;s the best route I found — slippage-protected, with the fee shown up front.</>, "swap");
            setChips(["Explain the routing fee", "What's slippage?", "Deposit to vault after"]);
          },
        );
      } else if (
        q.includes("deposit") ||
        q.includes("confirm") ||
        q.includes("sign") ||
        q.includes("to work") ||
        q.includes("put usdc") ||
        q.includes("put my usdc")
      ) {
        think(
          [
            { a: "Reading your idle USDC", b: "Read your idle USDC" },
            { a: "Building the vault deposit", b: "Built the vault deposit" },
            { a: "Checking your guardrails", b: "Checked your guardrails" },
          ],
          () => {
            pushAi(
              <>
                Let&apos;s put your idle <b>2,150 USDC</b> into the Aave Yield Vault. Review every change and sign right
                here — you never leave the chat.
              </>,
            );
            pushInline({ kind: "deposit" });
            setChips(["What's the risk?", "Explain net APY", "Show my portfolio"]);
          },
        );
      } else if (
        q.includes("wallet") ||
        q.includes("balance") ||
        q.includes("hold") ||
        q.includes("what's in") ||
        q.includes("what do i")
      ) {
        think(
          [
            { a: "Reading your wallet on Base", b: "Read your wallet on Base" },
            { a: "Pricing your assets", b: "Priced your assets" },
          ],
          () => {
            pushAi(
              <>
                Here&apos;s everything in your wallet right now. Your{" "}
                <span className="soft">idle USDC is the obvious lever</span> — it&apos;s earning nothing.
              </>,
              "wallet",
            );
            setChips(["Put my USDC to work", "Swap ETH → USDC", "Bridge to Sui"]);
          },
        );
      } else if (q.includes("aave") || q.includes("supply") || q.includes("lend")) {
        think(
          [
            { a: "Reading your wallet", b: "Read your wallet" },
            { a: "Checking the Aave v3 rate on Base", b: "Checked the Aave v3 rate on Base" },
            { a: "Simulating against current state", b: "Simulated against current state" },
          ],
          () => {
            pushAi(
              <>
                You can supply USDC straight to Aave v3 on Base — the same engine behind the vault, here as a direct
                position.
              </>,
              "rec",
            );
            setChips(["Vault vs direct supply?", "What's the risk?", "Review this move"]);
          },
        );
      } else if (q.includes("portfolio") || q.includes("how am i") || q.includes("doing")) {
        think(
          [
            { a: "Reading your wallet", b: "Read your wallet" },
            { a: "Pricing your positions", b: "Priced your positions" },
          ],
          () => {
            pushAi(
              <>
                Here&apos;s your position. You&apos;re <span className="soft">on plan</span> — steady and lower-risk.
              </>,
              "snapshot",
            );
            setChips(["Where's my risk concentrated?", "Improve my yield"]);
          },
        );
      } else if (
        q.includes("yield") ||
        q.includes("apy") ||
        q.includes("earn") ||
        q.includes("recommend") ||
        q.includes("move")
      ) {
        think(
          [
            { a: "Reading your wallet", b: "Read your wallet" },
            { a: "Checking current Aave rates", b: "Checked current Aave rates" },
            { a: "Scanning the Base vault", b: "Scanned the Base vault" },
          ],
          () => {
            pushAi(<>Your idle USDC could be earning. Here&apos;s the move I&apos;d suggest — tied to your goal.</>, "rec");
            setChips(["Compare options", "What's the risk?", "Explain net APY"]);
          },
        );
      } else if (q.includes("net apy") || q.includes("explain") || q.includes("what")) {
        think([{ a: "Pulling a plain explanation", b: "Ready" }], () => {
          pushAi(<>Quick version — and you can always go deeper.</>, "tip");
          setChips(["How does this affect me?", "Show my portfolio"]);
        });
      } else if (q.includes("past") || q.includes("outcome") || q.includes("changed") || q.includes("advice")) {
        think([{ a: "Loading your outcome log", b: "Loaded your outcome log" }], () => {
          pushAi(<>Here&apos;s a recent one — I show losses as plainly as wins.</>, "outcome");
          setChips(["See all outcomes", "Show my portfolio"]);
        });
      } else if (q.includes("safe") || q.includes("custod") || q.includes("keep my funds")) {
        pushAi(
          <>
            Your funds never touch us. Sparky can direct strategy but has <b>no code path</b> to take, move, or
            hold your money — and you can withdraw anytime, even if we&apos;re offline. Tap{" "}
            <b>Fully self-custodial</b> up top to see exactly what we can and can&apos;t do.
          </>,
        );
        setChips(["Show me the proof", "Withdraw anytime"]);
      } else {
        think([{ a: "Thinking", b: "Ready" }], () => {
          pushAi(
            <>
              I can help you understand your position, find lower-risk yield, explain a concept, or review a move — you
              approve and sign anything that moves funds. Try one of the suggestions below.
            </>,
          );
          setChips(EMPTY_CHIPS);
        });
      }
    },
    [pushAi, pushInline, think],
  );

  // ----- live send: stream ChatBlocks from POST /chat, rendered fail-closed -----
  // ----- persisted per-wallet history (B1) -----
  const refreshHistory = useCallback(async () => {
    if (!agentClient) return;
    try {
      const r = await agentClient.request<{ conversations: { id: string; title: string }[] }>(
        "/conversations",
      );
      setHistory(r.conversations ?? []);
    } catch {
      /* history is a nicety — never block the chat on it */
    }
  }, [agentClient]);

  useEffect(() => {
    // Load the wallet's chat history when the live agent becomes available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (online) void refreshHistory();
  }, [online, refreshHistory]);

  const sendLive = useCallback(
    async (text: string) => {
      if (!agentClient) {
        respond(text);
        return;
      }
      const turnId = nextId();
      setTurns((t) => [...t, { id: turnId, kind: "live", cards: [], streaming: true }]);
      const patch = (fn: (turn: Extract<Turn, { kind: "live" }>) => Extract<Turn, { kind: "live" }>) =>
        setTurns((t) => t.map((x) => (x.id === turnId && x.kind === "live" ? fn(x) : x)));
      try {
        const gen = agentClient.streamChat({
          message: text,
          conversationId: convRef.current,
          context: { surface: "chat" },
          clientTime: new Date().toISOString(),
        });
        for (;;) {
          const res = await gen.next();
          if (res.done) {
            if (res.value?.conversationId) convRef.current = res.value.conversationId;
            break;
          }
          // Each SSE block is validated fail-closed (invalid → inert, never actionable).
          const card = parseCard(res.value);
          patch((x) => ({ ...x, cards: [...x.cards, card] }));
        }
        patch((x) => ({ ...x, streaming: false }));
        void refreshHistory(); // a live turn may have created/renamed a persisted thread
      } catch (e) {
        const message =
          e instanceof AgentApiError ? e.message : "The assistant is unavailable right now. Nothing moved.";
        patch((x) => ({ ...x, streaming: false, error: message }));
      }
    },
    [agentClient, respond, refreshHistory],
  );

  const openConversation = useCallback(
    async (id: string) => {
      if (!agentClient) return;
      setActiveConvId(id);
      convRef.current = id;
      try {
        const c = await agentClient.request<{ turns: { role: string; content: string }[] }>(
          `/conversations/${id}`,
        );
        // Replay persisted turns (assistant content is a compact summary, not the live cards).
        setTurns(
          c.turns
            .filter((t) => t.content.trim().length > 0)
            .map((t) =>
              t.role === "user"
                ? { id: nextId(), kind: "user" as const, text: t.content }
                : { id: nextId(), kind: "ai" as const, text: t.content },
            ),
        );
        setChips(EMPTY_CHIPS);
      } catch {
        setTurns([{ id: nextId(), kind: "ai", text: "Couldn’t load that conversation." }]);
      }
    },
    [agentClient],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      if (!agentClient) return;
      if (!window.confirm("Delete this conversation? This can’t be undone.")) return;
      try {
        await agentClient.request(`/conversations/${id}/delete`, { method: "POST", body: {} });
      } catch {
        /* best-effort */
      }
      if (convRef.current === id) startNewChat();
      void refreshHistory();
    },
    [agentClient, refreshHistory],
  );

  // ----- send (user turn + live stream, or the mock keyword router offline) -----
  const send = useCallback(
    (text: string) => {
      if (!text || !text.trim()) return;
      const t = text.trim();
      setTurns((prev) => [...prev, { id: nextId(), kind: "user", text: t }]);
      if (online) void sendLive(t);
      else respond(t);
      setDraft("");
      if (taRef.current) taRef.current.style.height = "auto";
    },
    [respond, online, sendLive],
  );

  // card-action wiring shared by every card
  const cardActions: CardActions = {
    review: pushInline,
    dismiss: () => toast("Dismissed — nothing moved."),
    send,
    cite: openCite,
  };

  function renderCard(card: CardKind) {
    switch (card) {
      case "rec":
        return <RecCard actions={cardActions} />;
      case "snapshot":
        return <SnapshotCard actions={cardActions} />;
      case "tip":
        return <TipCard />;
      case "outcome":
        return <OutcomeCard actions={cardActions} />;
      case "wallet":
        return <WalletCard actions={cardActions} />;
      case "swap":
        return <SwapCard actions={cardActions} />;
      case "bridge":
        return <BridgeCard actions={cardActions} />;
    }
  }

  return (
    <>
    <div className="chatwrap fullbleed">
      <aside className="threadrail">
        <button className="newchat" onClick={startNewChat}>
          <Icon name="plus" size={16} /> New chat
        </button>

        {/* Persisted per-wallet history (B1) — real threads, individually deletable. */}
        {history.length > 0 && (
          <div
            style={{
              marginTop: 12, padding: "8px 10px", fontSize: 12, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted-foreground)",
            }}
          >
            Your chats
          </div>
        )}
        {history.map((h) => (
          <div
            key={h.id}
            className={"threaditem" + (h.id === activeConvId ? " active" : "")}
            onClick={() => openConversation(h.id)}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tt" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.title}
              </div>
            </div>
            <button
              title="Delete conversation"
              onClick={(e) => {
                e.stopPropagation();
                void deleteConversation(h.id);
              }}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--muted-foreground)", padding: 2, flex: "none",
              }}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </aside>

      <div className="chatcol">
        <div className="chatscroll" ref={scrollerRef}>
          <div className="chatstream">
            {!online && (
              <div
                className="cturn ai"
                style={{
                  margin: "4px auto 10px",
                  padding: "8px 12px",
                  maxWidth: 620,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "var(--caution)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 10,
                  background: "color-mix(in srgb, var(--caution) 8%, transparent)",
                }}
              >
                <b>Demo mode</b> — the live assistant is offline (or your wallet isn’t connected),
                so replies below are scripted, not real AI answers. Connect + sign in to
                talk to the live assistant. Your funds are unaffected either way.
              </div>
            )}
            {turns.map((turn) => {
              if (turn.kind === "user") {
                return (
                  <div className="cturn user" key={turn.id}>
                    <div className="cbubble-user">{turn.text}</div>
                  </div>
                );
              }
              if (turn.kind === "thinking") {
                return <ThinkingTurn key={turn.id} steps={turn.steps} onDone={turn.then} onTick={scrollDown} />;
              }
              if (turn.kind === "inline") {
                return (
                  <AiFrame key={turn.id}>
                    <div className="ctext">
                      Here&apos;s the full preview — review every change and sign right here.{" "}
                      <b>Nothing moves until you sign.</b>
                    </div>
                    <InlineConfirm intent={turn.intent} />
                  </AiFrame>
                );
              }
              if (turn.kind === "live") {
                return (
                  <AiFrame key={turn.id}>
                    <LiveBlocks
                      cards={turn.cards}
                      streaming={turn.streaming}
                      error={turn.error}
                      onReview={pushInline}
                      onCite={openCite}
                    />
                  </AiFrame>
                );
              }
              // ai text (+ optional card)
              return (
                <AiFrame key={turn.id}>
                  <div className="ctext">{turn.text}</div>
                  {turn.card && renderCard(turn.card)}
                </AiFrame>
              );
            })}
          </div>
        </div>

        <div className="composer-wrap">
          <div className="chips">
            {chips.map((c) => (
              <button className="chip" key={c} onClick={() => send(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="composer">
            <textarea
              ref={taRef}
              rows={1}
              value={draft}
              placeholder="Ask about your wallet, or tell me your goal…"
              onChange={(e) => {
                setDraft(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
            />
            <button className="sendbtn" onClick={() => send(draft)} disabled={!draft.trim()}>
              <Icon name="up" size={18} />
            </button>
          </div>
          <div className="cdisc">
            AI suggests — you approve &amp; sign. Not financial advice · capital at risk · Sparky can&apos;t move
            your funds.
          </div>
        </div>
      </div>

      <aside className="ctx">
        <div className="ctx-card">
          <div className="ck">Your mandate</div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
            <RiskChip tier={1} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Steady USDC yield · capital-preservation-first.{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => go("settings")}>
              Edit
            </a>
          </div>
        </div>
        <div className="ctx-card">
          <div className="ck">Portfolio</div>
          <div style={{ fontSize: 20, fontWeight: 600 }} className="tnum">
            {railNetWorth}
          </div>
          {railUnrealized !== undefined && railUnrealized !== null ? (
            <div
              className={"delta " + (railUnrealized >= 0 ? "up" : "down")}
              style={{ fontSize: 12.5, marginTop: 3 }}
            >
              <Icon name={railUnrealized >= 0 ? "up" : "down"} size={13} />
              {railUnrealized >= 0 ? "+" : "−"}
              {money(Math.abs(railUnrealized))} unrealized
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 3 }}>
              {railPreview
                ? "Preview — connect for your position"
                : railLive
                  ? "USDC · vault + wallet"
                  : railLoading
                    ? "…"
                    : "Position unavailable right now"}
            </div>
          )}
        </div>
        <div className="ctx-card">
          <div className="ck">Quick links</div>
          <div className="qlink" onClick={() => go("portfolio")}>
            <Icon name="portfolio" /> Portfolio
          </div>
          <div className="qlink" onClick={() => go("vault")}>
            <Icon name="vault" /> Vault
          </div>
          <div className="qlink" onClick={() => go("strategies")}>
            <Icon name="strategies" /> Strategies
          </div>
          <div className="qlink" onClick={() => go("trust")}>
            <Icon name="shieldcheck" /> Trust Center
          </div>
        </div>
        <div className="ctx-card">
          <div className="ck">Automation</div>
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            No active session keys. You sign every move.{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => go("automation")}>
              Set up
            </a>
          </div>
        </div>
      </aside>
    </div>
    {mounted &&
      citeOpen &&
      createPortal(
        <>
          <div className={"scrim" + (citeShow ? " show" : "")} onClick={closeCite} />
          <div className={"sheet" + (citeShow ? " show" : "")} role="dialog" aria-label="Source">
            <div className="sheet-hd">
              <span className="t">Source</span>
              <button className="iconbtn" onClick={closeCite} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="sheet-bd">
              <CiteBody />
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );

  // "New chat" — the LIVE surface: reset to the cold-start greeting (chat.js newchat handler).
  function startNewChat() {
    setActiveConvId(null);
    convRef.current = undefined;
    setTurns(coldThread());
    setChips(EMPTY_CHIPS);
  }
}

/** The AI turn chrome: avatar + name + body (the design's `aiTurn`). */
function AiFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="cturn ai">
      <div className="cav">
        <SparkMark size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="cname">Sparky AI</div>
        {children}
      </div>
    </div>
  );
}
