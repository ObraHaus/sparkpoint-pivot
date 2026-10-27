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
import {
  IDLE,
  decideSend,
  queueNotice,
  serialQueue,
  suggestionsVisible,
  type QueueSnapshot,
  type SerialQueue,
} from "@/lib/chat/sendQueue";
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
import { reduceTextDelta } from "@/lib/chat/streamText";
import { turnCanRetry } from "@/lib/agent/chatError";
import { useAccount, useBalance } from "wagmi";
import { useVault } from "@/lib/chain/useVault";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { derivePortfolio } from "@/lib/portfolio/derive";
import "@/components/screens/chat.css";

/** Read the deployed vault on Base Sepolia even before a wallet connects (mirrors portfolio/page). */
const CHAT_DISPLAY_CHAIN_ID = APP_DEFAULT_CHAIN_ID;

/**
 * The Robinhood Chain (4663) mainnet-beta build. On this build the ONLY live features are chat, a
 * user-signed ETH/WETH <-> USDG swap via the on-chain Uniswap V3, and read-only portfolio — there
 * is NO Aave vault, NO Aerodrome, NO Sui bridge. The scripted "Demo mode" replies below showcase
 * only those real capabilities; every other build (alpha/testnet, where this const is false) keeps
 * its existing Aave/Base/Sui demo byte-for-byte in the else paths.
 */
const IS_ROBINHOOD_MAINNET_BUILD = APP_DEFAULT_CHAIN_ID === 4663;

type CardKind = "rec" | "snapshot" | "tip" | "outcome" | "wallet" | "swap" | "bridge";

/** A single rendered turn in the thread. */
type Turn =
  // 041 — `wait` is what makes queueing honest. A message shown in the thread with no further
  // marking reads as sent; these have not been. "queued" is waiting its turn, "unsent" is one the
  // queue never got to because an earlier message failed.
  | { id: number; kind: "user"; text: string; wait?: "queued" | "unsent" }
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
      /** 059/A2 — provisional prose painted by `text-delta`; the final block replaces it. */
      deltaText?: string;
      deltaTarget?: "text" | "tip";
      /** Changes when a retry starts, so the buffer resets instead of concatenating attempts. */
      deltaStreamId?: string;
      /**
       * The message this turn was sent with, so "Try again" can resend it verbatim.
       *
       * 041b — ALWAYS set, where it used to be written only when the request threw. A turn that
       * reached the model and got a 502 back streams an `error` BLOCK on a 200 response, so there
       * was no failed message to offer and the button never rendered — on the failure that
       * actually happens. Whether it may be offered is `turnCanRetry`, not whether this is set.
       */
      message: string;
    };

/** 041 — a message the queue is holding, tied to the turn already rendered for it. */
interface QueuedMessage {
  /** The `Turn.id` of the user bubble, so the queue can mark it sending / unsent. */
  id: number;
  text: string;
}

// 037 — the empty-thread chips live with the follow-up logic now, so the two sets are chosen
// together rather than drifting apart in separate files. On the Robinhood Chain beta build the
// shared STARTER_CHIPS (Aave/USDC/Sui/vault) are wrong-network, so the initial / new-chat / resume
// suggestions use 4663-appropriate starters (swap + wallet + safety + capabilities) here at the
// consumer — leaving `followups.ts` a pure leaf module (no build-const import → no test-alias break).
// Alpha/testnet (const=false) keeps `[...STARTER_CHIPS]` byte-identical.
const EMPTY_CHIPS: string[] = IS_ROBINHOOD_MAINNET_BUILD
  ? ["Swap ETH → USDG", "What’s in my wallet?", "How do you keep my funds safe?", "What can you do?"]
  : [...STARTER_CHIPS];

// 037's follow-up chips are written for the alpha product (Aave vault, direct supply). On the
// Robinhood Chain beta those suggestions are wrong-network, so the explicit alpha-only ones are
// dropped here at the consumer — leaving `followups.ts` a pure leaf module.
const BETA_BLOCKED_CHIP = /aave|direct supply/i;
const betaChips = (chips: string[]): string[] =>
  IS_ROBINHOOD_MAINNET_BUILD ? chips.filter((c) => !BETA_BLOCKED_CHIP.test(c)) : chips;

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
  return betaChips(followUps({ userMessage, blockTypes, tipTopics, stepLabels }));
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
  // 041 — one turn at a time. See `lib/chat/sendQueue.ts` for what parallel sends actually did.
  const [queue, setQueue] = useState<QueueSnapshot>(IDLE);
  /**
   * Which conversation the in-flight send belongs to. Bumped by "New chat" and by opening a thread
   * from the sidebar, so a stream started against the previous conversation cannot write its
   * conversation id, its cards or its follow-up chips into the one now on screen.
   */
  const epochRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Feature 006: pause the force-refresh while a chat answer is streaming or an unsent draft exists
  // (BUSY — data loss, not funds). `streaming` is derived from the live turn's own flag.
  const streaming = turns.some((t) => t.kind === "live" && t.streaming);
  // 041 — a queued message is unsent work too, so the auto-reload waits for it exactly as it waits
  // for a stream or an untyped draft. Reloading would discard it silently.
  useHoldCriticalOp(streaming || queue.busy || queue.queued > 0 || draft.trim().length > 0, "busy");

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

  /**
   * 048 — the `/vault` board's "Ask Sparky about vaults" entry point arrives as `?ask=…`.
   *
   * PREFILLED, not auto-sent: the user reads the question, edits it if they like, and presses send.
   * Auto-sending from a link would spend a model turn the moment the page loads and take the
   * decision away from the person. Read once from `window.location` (a one-shot client action, so
   * no `useSearchParams` Suspense boundary is needed), then strip the param so a refresh does not
   * re-prefill over a draft.
   */
  const askPrefilledRef = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect -- The `?ask=` param exists only in the browser
     URL, so it cannot be initial state. It is read ONCE, the URL is stripped, and the ref guards
     re-entry, so this cannot cascade. */
  useEffect(() => {
    if (askPrefilledRef.current) return;
    const ask = new URLSearchParams(window.location.search).get("ask");
    if (!ask) return;
    askPrefilledRef.current = true;
    setDraft(ask.slice(0, 300));
    window.history.replaceState(null, "", window.location.pathname);
    taRef.current?.focus();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
  // 041 — the scripted demo path is animated, not awaited, so the queue needs a completion signal
  // from it. `thinkSeq` counts thinking turns created (synchronously, inside `respond`), and
  // `thinkDone` is the queue's resolver, fired when the animation finishes. Without this the
  // offline path would still send in parallel, and a fix that only works when connected is not a
  // fix — it is a fix you cannot demonstrate.
  const thinkSeq = useRef(0);
  const thinkDone = useRef<(() => void) | null>(null);
  const settleThink = useCallback(() => {
    const resolve = thinkDone.current;
    thinkDone.current = null;
    resolve?.();
  }, []);
  const think = useCallback((steps: ThinkStep[], then: () => void) => {
    thinkSeq.current += 1;
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
        if (IS_ROBINHOOD_MAINNET_BUILD) {
          think(
            [{ a: "Checking what's live on Robinhood Chain", b: "Checked what's live on Robinhood Chain" }],
            () => {
              pushAi(
                <>
                  Bridging isn&apos;t available on Robinhood Chain yet — there&apos;s no other network to move funds to
                  from here. What you can do today is swap <b>ETH/WETH</b> and <b>USDG</b>, both ways, on the Swap page,
                  and I can read your wallet. You approve and sign every move.
                </>,
              );
              setChips(["Swap ETH → USDG", "Show my wallet", "What's slippage?"]);
            },
          );
        } else {
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
        }
      } else if (
        q.includes("swap") ||
        q.includes("convert") ||
        (q.includes("eth") && q.includes("usdc")) ||
        (IS_ROBINHOOD_MAINNET_BUILD && q.includes("eth") && q.includes("usdg"))
      ) {
        if (IS_ROBINHOOD_MAINNET_BUILD) {
          think(
            [
              { a: "Reading your wallet", b: "Read your wallet" },
              { a: "Finding the best route on Robinhood Chain", b: "Found the best route on Robinhood Chain" },
              { a: "Checking slippage", b: "Checked slippage" },
            ],
            () => {
              pushAi(
                <>
                  Here&apos;s a swap between <b>ETH/WETH</b> and <b>USDG</b> — slippage-protected, with the fee shown up
                  front. You sign it from your own wallet.
                </>,
                "swap",
              );
              setChips(["Explain the routing fee", "What's slippage?", "Show my wallet"]);
            },
          );
        } else {
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
        }
      } else if (
        q.includes("deposit") ||
        q.includes("confirm") ||
        q.includes("sign") ||
        q.includes("to work") ||
        q.includes("put usdc") ||
        q.includes("put my usdc")
      ) {
        if (IS_ROBINHOOD_MAINNET_BUILD) {
          think(
            [
              { a: "Reading your wallet", b: "Read your wallet" },
              { a: "Checking what's live on Robinhood Chain", b: "Checked what's live on Robinhood Chain" },
            ],
            () => {
              pushAi(
                <>
                  There&apos;s no AI yield vault on Robinhood Chain yet, so there&apos;s nothing to deposit into here.
                  What you can do today is swap <b>ETH/WETH</b> and <b>USDG</b>, both ways, on the Swap page, and I can
                  read your wallet. You approve and sign every move.
                </>,
              );
              setChips(["Swap ETH → USDG", "Show my wallet", "What's slippage?"]);
            },
          );
        } else {
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
        }
      } else if (
        q.includes("wallet") ||
        q.includes("balance") ||
        q.includes("hold") ||
        q.includes("what's in") ||
        q.includes("what do i")
      ) {
        if (IS_ROBINHOOD_MAINNET_BUILD) {
          think(
            [
              { a: "Reading your wallet on Robinhood Chain", b: "Read your wallet on Robinhood Chain" },
              { a: "Pricing your assets", b: "Priced your assets" },
            ],
            () => {
              pushAi(
                <>
                  Here&apos;s everything in your wallet right now. If you&apos;d like, I can help you swap between{" "}
                  <span className="soft">ETH/WETH and USDG</span> — you approve and sign.
                </>,
                "wallet",
              );
              setChips(["Swap ETH → USDG", "What's slippage?", "Show my portfolio"]);
            },
          );
        } else {
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
        }
      } else if (q.includes("aave") || q.includes("supply") || q.includes("lend")) {
        if (IS_ROBINHOOD_MAINNET_BUILD) {
          think(
            [
              { a: "Reading your wallet", b: "Read your wallet" },
              { a: "Checking what's live on Robinhood Chain", b: "Checked what's live on Robinhood Chain" },
            ],
            () => {
              pushAi(
                <>
                  The AI yield vault isn&apos;t on Robinhood Chain yet, so there&apos;s no lending position I can set up
                  here. Today you can swap <b>ETH/WETH</b> and <b>USDG</b>, both ways, on the Swap page, and I can read
                  your wallet. I&apos;ll surface earning options here the moment they go live.
                </>,
              );
              setChips(["Swap ETH → USDG", "Show my wallet", "What's slippage?"]);
            },
          );
        } else {
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
        }
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
        if (IS_ROBINHOOD_MAINNET_BUILD) {
          think(
            [
              { a: "Reading your wallet", b: "Read your wallet" },
              { a: "Checking what's live on Robinhood Chain", b: "Checked what's live on Robinhood Chain" },
            ],
            () => {
              pushAi(
                <>
                  The AI yield vault isn&apos;t on Robinhood Chain yet, so I don&apos;t have an earning move to suggest
                  here. What you can do today is swap <b>ETH/WETH</b> and <b>USDG</b>, both ways, on the Swap page, and I
                  can read your wallet. You approve and sign every move.
                </>,
              );
              setChips(["Swap ETH → USDG", "Show my wallet", "What's slippage?"]);
            },
          );
        } else {
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
        }
      } else if (q.includes("net apy") || q.includes("explain") || q.includes("what")) {
        think([{ a: "Pulling a plain explanation", b: "Ready" }], () => {
          pushAi(<>Quick version — and you can always go deeper.</>, "tip");
          setChips(["How does this affect me?", "Show my portfolio"]);
        });
      } else if (q.includes("past") || q.includes("outcome") || q.includes("changed") || q.includes("advice")) {
        if (IS_ROBINHOOD_MAINNET_BUILD) {
          think([{ a: "Loading your recent swaps", b: "Loaded your recent swaps" }], () => {
            pushAi(<>Here&apos;s a recent swap — I show every fill plainly, wins and losses alike.</>, "outcome");
            setChips(["Swap ETH → USDG", "Show my wallet"]);
          });
        } else {
          think([{ a: "Loading your outcome log", b: "Loaded your outcome log" }], () => {
            pushAi(<>Here&apos;s a recent one — I show losses as plainly as wins.</>, "outcome");
            setChips(["See all outcomes", "Show my portfolio"]);
          });
        }
      } else if (q.includes("safe") || q.includes("custod") || q.includes("keep my funds")) {
        pushAi(
          <>
            Your funds never touch us. Sparky can direct strategy but has <b>no code path</b> to take, move, or
            hold your money — and you can withdraw anytime, even if we&apos;re offline. Tap{" "}
            <b>Fully self-custodial</b> up top to see exactly what we can and can&apos;t do.
          </>,
        );
        setChips(["Show me the proof", "Withdraw anytime"]);
      } else if (IS_ROBINHOOD_MAINNET_BUILD) {
        think([{ a: "Thinking", b: "Ready" }], () => {
          pushAi(
            <>
              I can help you understand your wallet, swap <b>ETH/WETH</b> and <b>USDG</b>, or explain a concept — you
              approve and sign anything that moves funds. Try one of the suggestions below.
            </>,
          );
          setChips(["Swap ETH → USDG", "Show my wallet", "What's slippage?"]);
        });
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
    async ({ offset = 0, q = "" }: { offset?: number; q?: string } = {}) => {
      if (!agentClient) return;
      const append = offset > 0;
      setHistoryBusy(true);
      setHistoryError(null);
      try {
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
    // ⚠️ `history.length` MUST NOT be a dependency. It was, and the result was an effect that
    // re-ran on its own output: appending a page changed the length, which changed this callback's
    // identity, which changed `refreshHistory`, which re-fired the mount effect below and reloaded
    // page one — so "Show 60 older conversations" appended fifty rows and then instantly threw them
    // away. The row count went 50 → 50 and nothing errored. The offset is passed in by the caller
    // instead, which keeps this stable.
    [agentClient],
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
    async (text: string): Promise<boolean> => {
      if (!agentClient) {
        respond(text);
        return true;
      }
      const turnId = nextId();
      // 041 — the conversation this send belongs to. If the user opens another thread or starts a
      // new chat while it is in flight, everything below becomes a write into the wrong screen.
      const epoch = epochRef.current;
      const current = () => epochRef.current === epoch;
      const controller = new AbortController();
      abortRef.current = controller;
      setTurns((t) => [...t, { id: turnId, kind: "live", cards: [], streaming: true, message: text }]);
      const patch = (fn: (turn: Extract<Turn, { kind: "live" }>) => Extract<Turn, { kind: "live" }>) =>
        setTurns((t) => t.map((x) => (x.id === turnId && x.kind === "live" ? fn(x) : x)));
      try {
        const gen = agentClient.streamChat(
          {
            message: text,
            conversationId: convRef.current,
            context: { surface: "chat" },
            clientTime: new Date().toISOString(),
          },
          { signal: controller.signal },
        );
        for (;;) {
          const res = await gen.next();
          if (res.done) {
            if (res.value?.conversationId && current()) {
              // THE FORK FIX. Until this line runs, `convRef.current` is undefined and the agent
              // treats a missing id as "make a new conversation" — which is why parallel sends in a
              // fresh chat each got their own thread. Serialising means the next message waits for
              // exactly this assignment.
              convRef.current = res.value.conversationId;
              // A brand-new conversation becomes the one a refresh restores.
              rememberConversation(res.value.conversationId);
            }
            break;
          }
          // 059/A2 — incremental prose paint. The final text/tip block still arrives below and
          // REPLACES this buffer (guardrail rewrite / clamp / retry / fallback), so the persisted
          // block — not anything streamed — is what the thread keeps.
          if (typeof res.value !== "string") {
            const delta = res.value;
            patch((x) => {
              const next = reduceTextDelta(
                { text: x.deltaText ?? "", target: x.deltaTarget, streamId: x.deltaStreamId },
                delta,
              );
              return {
                ...x,
                deltaText: next.text,
                deltaTarget: next.target,
                deltaStreamId: next.streamId,
              };
            });
            continue;
          }
          // Each SSE block is validated fail-closed (invalid → inert, never actionable).
          const card = parseCard(res.value);
          // Only the authoritative PROSE block (or a failure) ends the provisional paint. A
          // trailing `tool_step(done)` / citation must not blink the text away before the final
          // `text` / `tip` block arrives.
          const endsPaint =
            card.status === "inert" ||
            (card.status === "valid" &&
              (card.block.type === "text" ||
                card.block.type === "tip" ||
                card.block.type === "error"));
          patch((x) => ({
            ...x,
            cards: [...x.cards, card],
            deltaText: endsPaint ? undefined : x.deltaText,
            deltaTarget: endsPaint ? undefined : x.deltaTarget,
            deltaStreamId: endsPaint ? undefined : x.deltaStreamId,
          }));
        }
        // The user has moved on: the answer is persisted server-side and will be there when they
        // reopen the thread, but nothing about it belongs on the screen they are looking at now.
        if (!current()) return true;
        patch((x) => ({
          ...x,
          streaming: false,
          deltaText: undefined,
          deltaTarget: undefined,
          deltaStreamId: undefined,
        }));
        // 037 — suggest what to do NEXT, from what actually just happened. The scripted demo paths
        // had done this all along; a real turn left the starter chips up, so after being told
        // what was in your wallet the thread still offered "What's in my wallet?".
        setTurns((all) => {
          const turn = all.find((x) => x.id === turnId);
          if (turn?.kind === "live") setChips(followUpsFor(text, turn.cards));
          return all;
        });
        void refreshHistory(); // a live turn may have created/renamed a persisted thread
        return true;
      } catch (e) {
        // An abort is the user switching threads, not a failure — say nothing and leave the queue
        // to be cleared by whoever switched.
        if (controller.signal.aborted || !current()) return true;
        // A failed turn had no conversation, so it gets no follow-ups about one: "What's the risk?"
        // under a failure reads as though nothing went wrong.
        setChips([...ERROR_FOLLOW_UPS]);
        const message =
          e instanceof AgentApiError ? e.message : "The assistant is unavailable right now. Nothing moved.";
        // 029: keep the CODE and the original message. The renderer replaces internal envelopes
        // with honest copy, and "Try again" resends without the user retyping.
        const errorCode = e instanceof AgentApiError ? e.code : undefined;
        patch((x) => ({
          ...x,
          streaming: false,
          error: message,
          errorCode,
          // A mid-stream failure NEVER leaves partial prose looking like an answer (056/059).
          deltaText: undefined,
          deltaTarget: undefined,
          deltaStreamId: undefined,
        }));
        return false;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [agentClient, respond, refreshHistory],
  );

  /* ── 041 · the serial send queue ─────────────────────────────────────────── */

  /**
   * The offline keyword router as something the queue can await.
   *
   * `respond` dispatches an ANIMATION and returns immediately, so there is nothing to await. The
   * completion signal is the thinking turn finishing — see `settleThink`.
   */
  const respondAsync = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        const before = thinkSeq.current;
        thinkDone.current = resolve;
        respond(text);
        // Every branch of the router animates a thinking turn today. If one ever stops doing so,
        // the queue must not wedge forever waiting for an animation that will never run.
        if (thinkSeq.current === before) settleThink();
      }),
    [respond, settleThink],
  );

  const markTurn = useCallback((id: number, wait: "queued" | "unsent" | undefined) => {
    setTurns((all) => all.map((t) => (t.id === id && t.kind === "user" ? { ...t, wait } : t)));
  }, []);
  const markTurnRef = useRef(markTurn);
  useEffect(() => {
    markTurnRef.current = markTurn;
  }, [markTurn]);

  const runQueued = useCallback(
    async (item: QueuedMessage) => {
      markTurn(item.id, undefined); // it is going out now — stop calling it queued
      if (online) {
        // A rejected promise is how the queue learns to stop; `sendLive` has already rendered the
        // honest error card and the per-turn "Try again".
        if (!(await sendLive(item.text))) throw new Error("chat turn failed");
      } else {
        await respondAsync(item.text);
      }
    },
    [markTurn, online, respondAsync, sendLive],
  );

  // The queue outlives every re-render (recreating it would drop whatever is waiting), so it calls
  // the LATEST runner through a ref rather than closing over the one it was born with.
  const runRef = useRef(runQueued);
  useEffect(() => {
    runRef.current = runQueued;
  }, [runQueued]);

  const [queueRunner] = useState<SerialQueue<QueuedMessage>>(() =>
    serialQueue<QueuedMessage>({
      run: (item) => runRef.current(item),
      onChange: setQueue,
      // Nothing typed is ever thrown away: what the queue never got to is marked unsent, with its
      // text intact and a button to send it.
      onHalted: (remaining) => remaining.forEach((m) => markTurnRef.current(m.id, "unsent")),
    }),
  );

  /**
   * Abandon everything in flight or waiting, because the screen is about to become a different
   * conversation.
   *
   * ORDER MATTERS: clear the waiting messages BEFORE releasing the in-flight one. Aborting first
   * would let the drain advance to the next queued message and send it — into the thread the user
   * just navigated away from.
   */
  const resetSendQueue = useCallback(() => {
    queueRunner.clear();
    epochRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    settleThink(); // the demo animation is about to be unmounted; it will never report done
  }, [queueRunner, settleThink]);

  /** "New chat" — the LIVE surface: reset to the cold-start greeting (chat.js newchat handler). */
  const startNewChat = useCallback(() => {
    // 041 — whatever is queued was typed at the OLD conversation; sending it into a fresh one
    // would answer it in the wrong place.
    resetSendQueue();
    setActiveConvId(null);
    convRef.current = undefined;
    // An explicit "new chat" is also an explicit "not that one" — so a refresh right after it
    // must not drag the old conversation back.
    rememberConversation(null);
    restoredRef.current = true;
    setTurns(coldThread());
    setChips(EMPTY_CHIPS);
  }, [resetSendQueue]);

  const openConversation = useCallback(
    async (id: string) => {
      if (!agentClient) return;
      resetSendQueue();
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
        // 041b — an assistant turn carries the question it answered, so a retry offered on a
        // reopened thread would resend the right message. In practice a replayed turn never
        // carries an error block (a turn that errors writes no assistant row at all), so the
        // button will not appear here — but the field must be true rather than empty.
        let lastAsked = "";
        const replayed: Turn[] = replayTurns(c.turns).map((t) => {
          if (t.kind === "user") {
            lastAsked = t.text;
            return { id: nextId(), kind: "user" as const, text: t.text };
          }
          if (t.kind === "cards") {
            return {
              id: nextId(),
              kind: "live" as const,
              // Streaming is over: a replayed turn is complete by definition.
              cards: t.cards.map((b) => parseCardValue(b)),
              streaming: false,
              message: lastAsked,
            };
          }
          return { id: nextId(), kind: "ai" as const, text: t.text };
        });
        setTurns(replayed);
        // 039 — a saved conversation is not a new one. It used to reset to the starters, so a
        // thread that had spent ten turns on fees reopened offering "What's in my wallet?".
        const resumed = betaChips(followUpsForThread(threadTurnsFor(replayed)));
        setChips(resumed.length ? resumed : EMPTY_CHIPS);
      } catch {
        setTurns([{ id: nextId(), kind: "ai", text: "Couldn’t load that conversation." }]);
      }
    },
    [agentClient, resetSendQueue],
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
    [agentClient, refreshHistory, startNewChat],
  );

  // ----- send: take the message, then let the queue decide when it goes out (041) -----
  const send = useCallback(
    (text: string) => {
      // The queue's OWN snapshot, not the React copy: two Enter presses in one tick both read the
      // same stale state, and "is something already in flight?" is exactly the question that must
      // not be answered from a stale copy.
      const decision = decideSend(text, queueRunner.snapshot());
      if (!decision.accepted) {
        if (decision.reason === "full") toast(decision.notice);
        return;
      }
      const id = nextId();
      setTurns((prev) => [
        ...prev,
        { id, kind: "user", text: decision.text, wait: decision.waits ? "queued" : undefined },
      ]);
      queueRunner.push({ id, text: decision.text });
      setDraft("");
      if (taRef.current) taRef.current.style.height = "auto";
    },
    [queueRunner, toast],
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
            onClick={() => void loadHistory({ offset: history.length, q: historyQuery })}
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
                    <div className={"cbubble-user" + (turn.wait ? " waiting" : "")}>{turn.text}</div>
                    {/* 041 — a bubble with no marking reads as sent. These have not been. */}
                    {turn.wait === "queued" && (
                      <div className="qmark">Queued — sends when the current answer finishes</div>
                    )}
                    {turn.wait === "unsent" && (
                      <div className="qmark unsent">
                        Not sent — the message before this one failed.{" "}
                        <button className="qsend" onClick={() => send(turn.text)}>
                          Send it now
                        </button>
                      </div>
                    )}
                  </div>
                );
              }
              if (turn.kind === "thinking") {
                return (
                  <ThinkingTurn
                    key={turn.id}
                    steps={turn.steps}
                    // 041 — the scripted path's completion signal: the answer appears, THEN the
                    // queue is released for the next message.
                    onDone={() => {
                      turn.then();
                      settleThink();
                    }}
                    onTick={scrollDown}
                  />
                );
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
                      deltaText={turn.deltaText}
                      deltaTarget={turn.deltaTarget}
                      error={turn.error}
                      errorCode={turn.errorCode}
                      // 041b — offered on BOTH failures now: a request that threw, and a turn
                      // that reached the model and streamed an error block back. The second is the
                      // common one (a 502 from the gateway), and it was the one with no button.
                      onRetry={
                        turnCanRetry({
                          streaming: turn.streaming,
                          error: turn.error,
                          blockTypes: turn.cards.flatMap((c) =>
                            c.status === "valid" ? [c.block.type] : [],
                          ),
                        })
                          ? () => send(turn.message)
                          : undefined
                      }
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
          {/* 041 — every chip is a send(), so showing them mid-turn was the product offering a way
              to fire a parallel message. They also suggest what to ask NEXT, and until the answer
              lands there is no "next" to suggest from. */}
          {suggestionsVisible(queue) && (
            <div className="chips">
              {chips.map((c) => (
                <button className="chip" key={c} onClick={() => send(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}
          {queueNotice(queue) && (
            <div className="qnotice" aria-live="polite">
              {queueNotice(queue)}
            </div>
          )}
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
