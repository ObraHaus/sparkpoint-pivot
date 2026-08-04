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
  groupConversations,
  olderLabel,
  rowTimestamp,
  type HistoryRow,
} from "@/lib/chat/historyGroups";
import {
  ERROR_FOLLOW_UPS,
  STARTER_CHIPS,
  followUps,
  followUpsForThread,
  type ThreadTurn,
} from "@/lib/chat/followups";
import { ExecutionDrawer } from "@/components/execution/ExecutionDrawer";
import type { ProposedAction } from "@sparkpoint/shared/schemas";
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
import { useAgentClient, usePortfolioView, useMandate } from "@/lib/agent/useAgent";
import { parseCard, parseCardValue, type ChatCard } from "@/lib/agent/cards";
import { replayTurns, type ConversationTurnDto } from "@/lib/agent/conversationReplay";
import {
  pickRestoreTarget,
  readRememberedConversation,
  rememberConversation,
} from "@/lib/chat/lastConversation";
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
  // The single signing chokepoint for an approved AI-proposed VAULT action (feature 019 US2).
  | { id: number; kind: "sign"; action: ProposedAction }
  // A LIVE `/chat` turn: streamed, fail-closed ChatBlocks from the agent service.
  | {
      id: number;
      kind: "live";
      cards: ChatCard[];
      streaming: boolean;
      error?: string;
      /** §1.6 code — lets the renderer recognise an internal envelope (029). */
      errorCode?: string;
      /** The message that failed, so "Try again" can resend it verbatim. */
      failedMessage?: string;
    };

// 037 — the empty-thread chips live with the follow-up logic now, so the two sets are chosen
// together rather than drifting apart in separate files.
const EMPTY_CHIPS: string[] = [...STARTER_CHIPS];

/**
 * 037 — the signals a finished turn offers, read off its own blocks.
 *
 * Inert cards are skipped: a block that failed validation tells us nothing about what was
 * discussed, and guessing from one would be guessing from noise.
 */
/**
 * 039 — a reopened conversation, reduced to what the suggestions need.
 *
 * The same projection as a live turn, applied to every assistant turn in the thread, so a thread
 * picked up from the sidebar gets chips about where it actually got to rather than the starters.
 */
function threadTurnsFor(turns: Turn[]): ThreadTurn[] {
  const out: ThreadTurn[] = [];
  for (const t of turns) {
    if (t.kind === "user") {
      out.push({ role: "user", text: t.text });
      continue;
    }
    if (t.kind === "live") {
      const blockTypes: string[] = [];
      const tipTopics: string[] = [];
      const stepLabels: string[] = [];
      for (const card of t.cards) {
        if (card.status === "inert") continue;
        blockTypes.push(card.block.type);
        if (card.block.type === "tip") tipTopics.push(card.block.topic);
        if (card.block.type === "tool_step") stepLabels.push(card.block.label);
      }
      out.push({ role: "assistant", blockTypes, tipTopics, stepLabels });
      continue;
    }
    // A pre-025 row replays as a text summary with no blocks — still an assistant turn, so the
    // thread does not read as new; it simply has no topic to go deeper on.
    if (t.kind === "ai") out.push({ role: "assistant" });
  }
  return out;
}

function followUpsFor(userMessage: string, cards: ChatCard[]): string[] {
  const blockTypes: string[] = [];
  const tipTopics: string[] = [];
  const stepLabels: string[] = [];
  for (const card of cards) {
    if (card.status === "inert") continue;
    const block = card.block;
    blockTypes.push(block.type);
    if (block.type === "tip") tipTopics.push(block.topic);
    if (block.type === "tool_step") stepLabels.push(block.label);
  }
  return followUps({ userMessage, blockTypes, tipTopics, stepLabels });
}

let UID = 0;
const nextId = () => ++UID;

/** The primed first message after onboarding (chat.js render bootstrap). */
/** The cold-start greeting (chat.js "New chat" handler). Also the DEFAULT opening: we never
 * assert a hardcoded plan (the user's REAL mandate is shown live in the right-rail card + via
 * useMandate) — a neutral greeting is honest; a fabricated "Your plan: lower risk (1/5)" is not. */
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

  const [turns, setTurns] = useState<Turn[]>(coldThread);
  // First load shows the same starter suggestions as "New chat" (EMPTY_CHIPS).
  const [chips, setChips] = useState<string[]>(EMPTY_CHIPS);
  // Persisted per-wallet chat history (B1): the user's real saved threads.
  // 040 — the API has always sent `updatedAt`, `createdAt` and `turnCount`; this narrowed them away
  // to `{id, title}`, which is why the sidebar had nothing to say about when anything happened.
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date(0));
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
  const mandate = useMandate();
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
  const pushSign = useCallback((action: ProposedAction) => {
    setTurns((t) => [...t, { id: nextId(), kind: "sign", action }]);
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
  const HISTORY_PAGE = 50;

  /**
   * 040 — one page of history, optionally searched.
   *
   * `append` adds a page rather than replacing the list, so "Show older" grows the sidebar instead
   * of redrawing it under the reader. The total comes back with every page, so the control can name
   * the exact number remaining rather than saying "Show more" and leaving the question open.
   */
  const loadHistory = useCallback(
    async ({ append = false, q = "" }: { append?: boolean; q?: string } = {}) => {
      if (!agentClient) return;
      setHistoryBusy(true);
      setHistoryError(null);
      try {
        const offset = append ? history.length : 0;
        const params = new URLSearchParams({ limit: String(HISTORY_PAGE), offset: String(offset) });
        if (q.trim()) params.set("q", q.trim());
        const r = await agentClient.request<{ conversations: HistoryRow[]; total?: number }>(
          `/conversations?${params.toString()}`,
        );
        const rows = r.conversations ?? [];
        setHistory((prev) => (append ? [...prev, ...rows] : rows));
        setHistoryTotal(r.total ?? rows.length);
      } catch {
        // A failure here must never take the sidebar with it: what is already loaded stays, and the
        // failure is stated rather than looking like an empty history.
        setHistoryError(append ? "Couldn't load older conversations." : "Couldn't load your chats.");
      } finally {
        setHistoryBusy(false);
      }
    },
    [agentClient, history.length],
  );

  const refreshHistory = useCallback(
    () => loadHistory({ q: historyQuery }),
    [loadHistory, historyQuery],
  );

  useEffect(() => {
    // Load the wallet's chat history when the live agent becomes available.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (online) void refreshHistory();
  }, [online, refreshHistory]);

  useEffect(() => {
    // The clock the grouping is computed against. Read once on mount and again every ten minutes,
    // so a sidebar left open across midnight corrects itself rather than insisting it is still
    // yesterday. Never read in render — that would make the component impure.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 600_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // One request per pause in typing, not one per keystroke (FR-017).
    if (!online) return;
    const id = setTimeout(() => void loadHistory({ q: historyQuery }), 300);
    return () => clearTimeout(id);
    // `loadHistory` is deliberately omitted: it changes whenever the loaded length changes, which
    // would re-fire the search on its own results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuery, online]);


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
            if (res.value?.conversationId) {
              convRef.current = res.value.conversationId;
              // A brand-new conversation becomes the one a refresh restores.
              rememberConversation(res.value.conversationId);
            }
            break;
          }
          // Each SSE block is validated fail-closed (invalid → inert, never actionable).
          const card = parseCard(res.value);
          patch((x) => ({ ...x, cards: [...x.cards, card] }));
        }
        patch((x) => ({ ...x, streaming: false }));
        // 037 — suggest what to do NEXT, from what actually just happened. The scripted demo paths
        // had done this all along; a real turn left the starter chips up, so after being told
        // what was in your wallet the thread still offered "What's in my wallet?".
        setTurns((all) => {
          const turn = all.find((x) => x.id === turnId);
          if (turn?.kind === "live") setChips(followUpsFor(text, turn.cards));
          return all;
        });
        void refreshHistory(); // a live turn may have created/renamed a persisted thread
      } catch (e) {
        // A failed turn had no conversation, so it gets no follow-ups about one: "What's the risk?"
        // under a failure reads as though nothing went wrong.
        setChips([...ERROR_FOLLOW_UPS]);
        const message =
          e instanceof AgentApiError ? e.message : "The assistant is unavailable right now. Nothing moved.";
        // 029: keep the CODE and the original message. The renderer replaces internal envelopes
        // with honest copy, and "Try again" resends without the user retyping.
        const errorCode = e instanceof AgentApiError ? e.code : undefined;
        patch((x) => ({ ...x, streaming: false, error: message, errorCode, failedMessage: text }));
      }
    },
    [agentClient, respond, refreshHistory],
  );

  const openConversation = useCallback(
    async (id: string) => {
      if (!agentClient) return;
      setActiveConvId(id);
      convRef.current = id;
      rememberConversation(id);
      try {
        const c = await agentClient.request<{ turns?: ConversationTurnDto[] }>(
          `/conversations/${id}`,
        );
        // Replay persisted turns (025). A turn that carries its structured blocks is rehydrated
        // through the SAME fail-closed validator and the SAME renderer as the live stream, so a
        // reopened conversation shows real cards instead of "[proposed action: aerodrome_swap]".
        // A turn without blocks — every pre-025 row — still replays as its text summary.
        const replayed: Turn[] = replayTurns(c.turns).map((t) =>
          t.kind === "user"
            ? { id: nextId(), kind: "user" as const, text: t.text }
            : t.kind === "cards"
              ? {
                  id: nextId(),
                  kind: "live" as const,
                  // Streaming is over: a replayed turn is complete by definition.
                  cards: t.cards.map((b) => parseCardValue(b)),
                  streaming: false,
                }
              : { id: nextId(), kind: "ai" as const, text: t.text },
        );
        setTurns(replayed);
        // 039 — a saved conversation is not a new one. It used to reset to the starters, so a
        // thread that had spent ten turns on fees reopened offering "What's in my wallet?".
        const resumed = followUpsForThread(threadTurnsFor(replayed));
        setChips(resumed.length ? resumed : EMPTY_CHIPS);
      } catch {
        setTurns([{ id: nextId(), kind: "ai", text: "Couldn’t load that conversation." }]);
      }
    },
    [agentClient],
  );

  // 029/FR-013 — come back to the conversation the refresh interrupted. Runs ONCE, and only
  // into an untouched screen: if the user has already started typing or opened something from
  // the sidebar, restoring would yank the page out from under them.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!online || restoredRef.current || activeConvId || history.length === 0) return;
    restoredRef.current = true;
    const target = pickRestoreTarget(history, readRememberedConversation());
    // Restoring is a REACTION to the history list arriving after mount — there is no
    // render-time value to derive it from, so this is the effect the rule exists to allow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (target) void openConversation(target);
  }, [online, history, activeConvId, openConversation]);

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
        {history.length > 0 && (
          <div style={{ padding: "2px 10px 8px" }}>
            <input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search your chats…"
              aria-label="Search your chats"
              style={{
                width: "100%", padding: "6px 9px", fontSize: 12.5, borderRadius: 7,
                border: "1px solid var(--border-soft)", background: "var(--background)",
                color: "var(--foreground)",
              }}
            />
          </div>
        )}

        {groupConversations(history, now).map((group) => (
          <div key={group.key}>
            {/* Sticky, so the group you are scrolling through stays named at the top of the list. */}
            <div
              style={{
                position: "sticky", top: 0, zIndex: 1, background: "var(--surface, var(--background))",
                padding: "8px 10px 4px", fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
                textTransform: "uppercase", color: "var(--muted-foreground)",
              }}
            >
              {group.label}{" "}
              <span style={{ fontWeight: 500, opacity: 0.65 }}>· {group.count}</span>
            </div>
            {group.rows.map((h) => (
              // 039 — role + tabIndex + key handler rather than a <button>, because the row contains
              // its own delete button and a button cannot nest inside one.
              <div
                key={h.id}
                className={"threaditem" + (h.id === activeConvId ? " active" : "")}
                role="button"
                tabIndex={0}
                aria-current={h.id === activeConvId ? "true" : undefined}
                onClick={() => openConversation(h.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void openConversation(h.id);
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tt" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.title}
                  </div>
                </div>
                {/* 040 — what tells five threads called "Explain the performance fee" apart. The
                    titles are honest; the time is the thing that actually differs. */}
                <span style={{ fontSize: 10.5, opacity: 0.55, whiteSpace: "nowrap" }}>
                  {rowTimestamp(h, now)}
                </span>
                <button
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteConversation(h.id);
                  }}
                  style={{ background: "none", border: 0, cursor: "pointer", color: "inherit", opacity: 0.45, padding: 2 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))}

        {historyQuery.trim() && history.length === 0 && !historyBusy && (
          <div style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--muted-foreground)" }}>
            No chats match “{historyQuery.trim()}”.
          </div>
        )}

        {historyError && (
          <div style={{ padding: "8px 12px", fontSize: 12.5, color: "var(--danger, #c1402e)" }}>
            {historyError}
          </div>
        )}

        {/* Its ABSENCE is a statement: it means this is all of them. So it renders only while more
            exist, and it always names the exact number remaining. */}
        {olderLabel(history.length, historyTotal) && (
          <button
            onClick={() => void loadHistory({ append: true, q: historyQuery })}
            disabled={historyBusy}
            style={{
              display: "block", width: "calc(100% - 20px)", margin: "6px 10px 2px",
              padding: "7px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              borderRadius: 7, border: "1px solid var(--border-soft)", background: "none",
              color: "var(--primary)",
            }}
          >
            {historyBusy ? "Loading…" : olderLabel(history.length, historyTotal)}
          </button>
        )}
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
              if (turn.kind === "sign") {
                return (
                  <AiFrame key={turn.id}>
                    <div className="ctext">
                      Here&apos;s the full preview — review every change and sign right here.{" "}
                      <b>Nothing moves until you sign.</b>
                    </div>
                    <ExecutionDrawer action={turn.action} />
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
                      errorCode={turn.errorCode}
                      onRetry={turn.failedMessage ? () => void send(turn.failedMessage!) : undefined}
                      onReview={pushInline}
                      onSign={pushSign}
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
          {mandate.status === "ready" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                <RiskChip tier={mandate.mandate.tier} />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                {mandate.mandate.goal} · {mandate.mandate.riskBlurb}.{" "}
                <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => go("settings")}>
                  Edit
                </a>
              </div>
            </>
          ) : mandate.status === "empty" ? (
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              No plan yet.{" "}
              <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => go("onboarding")}>
                Set one up
              </a>
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              {mandate.status === "loading"
                ? "Loading your plan…"
                : mandate.status === "disconnected"
                  ? "Connect to see your plan."
                  : "Plan unavailable right now."}
            </div>
          )}
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
    // An explicit "new chat" is also an explicit "not that one" — so a refresh right after it
    // must not drag the old conversation back.
    rememberConversation(null);
    restoredRef.current = true;
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
