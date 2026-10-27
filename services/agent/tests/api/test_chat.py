# ruff: noqa: S101, S105, S106  (pytest asserts; the token is a test fixture, not a secret)
"""§3.2 chat surface (api/chat.py) — SSE stream + thumbs feedback.

Everything runs against MOCKED LLM agents (canned ``StructuredResult`` / ``LlmResult``)
and in-memory read providers, but the policy GATE is the REAL ``policy.evaluate`` — so
these assert the custody-critical wire contract end to end through FastAPI:

  - the stream frames blocks as ``event: block`` records + a terminal ``event: done``;
  - a ``tool_step`` precedes a policy-STAMPED, ``approved`` recommendation (signable);
  - an out-of-policy (over-cap) proposal streams as ``rejected`` / non-signable, and NO
    block ever carries a signature or a bundle (that is the /build-tx chokepoint);
  - malformed LLM output degrades to an inert block (fail-closed), never an action, and
    the ``tool_step`` labels are code-authored (summarized trace, never raw CoT);
  - an unexpected mid-stream error degrades to a single inert ``error`` block;
  - ``POST /chat/feedback`` records the thumbs signal and returns 204.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender, _Rank
from sparkpoint_agent.agents.sparky import Sparky
from sparkpoint_agent.api.chat import (
    _MemorySink,
    _NoopConversationSink,
    _NoopMemorySink,
    get_chain_provider,
    get_conversation_sink,
    get_coordinator_dag,
    get_feedback_sink,
    get_memory_sink,
)
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
    PositionLite,
)
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import ActionType, Asset, CapHeadroom

TOKEN = "test-web-tier-token"
VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
OWNER = "0x3333333333333333333333333333333333333333"
BIG = 10**15

GOOD_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": USER,
    "X-Owner": OWNER,
    "X-Chain-Id": "8453",
}

_TOOL_LABELS = {
    "Understanding your request",
    "Explaining that",
    "Thinking that through",
    "Reading your portfolio",
    "Checking strategies against your guardrails",
}

# What the mocked general/identity responder (Sparky) says on an OTHER turn.
SPARKY_ANSWER = "I'm Sparky, SparkPoint's assistant. Only you can sign a transaction."


# ── fakes (mirror tests/coordinator/test_dag.py) ────────────────────────────────


class _StructuredLlm:
    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return self._result


class _CompleteLlm:
    def __init__(self, text: str) -> None:
        self._text = text

    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text=self._text, stop_reason="end_turn")


class _Portfolio:
    def __init__(self, view: PortfolioView) -> None:
        self._view = view

    async def read(self, chain: ChainContext) -> PortfolioView:
        return self._view


class _ExplodingPortfolio:
    """A read provider that raises — proves a mid-stream failure fails closed to an error block."""

    async def read(self, chain: ChainContext) -> PortfolioView:
        raise RuntimeError("boom: upstream read blew up")


class _Mandate:
    def __init__(self, view: MandateView | None) -> None:
        self._view = view

    async def active(self, chain: ChainContext) -> MandateView | None:
        return self._view


class _FakeChainProvider:
    def __init__(self, chain: ChainContext) -> None:
        self._chain = chain

    async def context(self, account: AccountContext, *, surface: str) -> ChainContext:
        return self._chain


class _RecordingSink:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, str | None]] = []

    async def record(
        self,
        *,
        conversation_id: str,
        block_id: str,
        rating: str,
        account: AccountContext,
        reason: str | None = None,
    ) -> None:
        self.calls.append((conversation_id, block_id, rating, reason))


def _seq_ids() -> Any:
    counter = {"n": 0}

    def factory() -> str:
        counter["n"] += 1
        return f"rec_{counter['n']}"

    return factory


def _ranking() -> dict[ActionType, _Rank]:
    return {
        ActionType.VAULT_DEPOSIT: _Rank(rank=1, title="Deposit into the vault", rationale="steady"),
        ActionType.AAVE_SUPPLY: _Rank(rank=2, title="Supply to Aave", rationale="raw yield"),
    }


def _dag(
    *,
    intent: Intent | None = None,
    planner_ok: bool = True,
    planner_refused: bool = False,
    reco: StructuredResult[Any] | None = None,
    portfolio: Any | None = None,
    mandate: MandateView | None = None,
) -> CoordinatorDag:
    if planner_refused:
        planner_result: StructuredResult[Any] = StructuredResult(ok=False, refused=True)
    elif not planner_ok:
        planner_result = StructuredResult(ok=False, error="no JSON")  # malformed → OTHER
    else:
        planner_result = StructuredResult(ok=True, value=intent)
    reco_result = reco if reco is not None else StructuredResult(ok=True, value=_ranking())
    return CoordinatorDag(
        planner=Planner(llm=_StructuredLlm(planner_result)),
        recommender=Recommender(llm=_StructuredLlm(reco_result)),
        literacy=Literacy(llm=_CompleteLlm("APY is your yearly yield.")),
        sparky=Sparky(llm=_CompleteLlm(SPARKY_ANSWER)),
        portfolio_provider=portfolio if portfolio is not None else _Portfolio(PortfolioView()),
        mandate_provider=_Mandate(mandate),
        id_factory=_seq_ids(),
    )


def _chain(*, per_user: int = BIG, market: MarketData | None = None) -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        owner=OWNER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=per_user, total=BIG, vault=BIG),
        market=market or MarketData(gross_apy_bps=421, projected_apy_bps=379),
    )


# ── SSE parsing helpers ─────────────────────────────────────────────────────────


def _parse_sse(text: str) -> list[tuple[str, dict[str, Any]]]:
    """Parse a raw SSE body into ``[(event, data), ...]`` (one entry per record)."""
    events: list[tuple[str, dict[str, Any]]] = []
    for record in text.split("\n\n"):
        record = record.strip()
        if not record:
            continue
        event: str | None = None
        data: dict[str, Any] | None = None
        for line in record.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = json.loads(line[len("data:") :].strip())
        assert event is not None and data is not None
        events.append((event, data))
    return events


def _blocks(events: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    return [data for name, data in events if name == "block"]


def _done(events: list[tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    dones = [data for name, data in events if name == "done"]
    assert len(dones) == 1  # exactly one terminal done event
    return dones[0]


def _has_signature(node: Any) -> bool:
    """True if any key anywhere in the block hints at a signable artifact (must never happen)."""
    forbidden = {"signature", "signedtx", "bundle", "intentbundle", "rawtx", "usersignature"}
    if isinstance(node, dict):
        if any(k.lower() in forbidden for k in node):
            return True
        return any(_has_signature(v) for v in node.values())
    if isinstance(node, list):
        return any(_has_signature(v) for v in node)
    return False


# ── fixtures ────────────────────────────────────────────────────────────────────


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _wire(dag: CoordinatorDag, chain: ChainContext) -> None:
    app.dependency_overrides[get_coordinator_dag] = lambda: dag
    app.dependency_overrides[get_chain_provider] = lambda: _FakeChainProvider(chain)
    # Hermetic: no DB-backed conversation persistence in the chat unit tests (B1) and no
    # DB-backed cross-conversation memory (027) — both sinks are fail-open in production, so the
    # no-op stand-ins reproduce exactly what a chat turn does with neither of them available.
    app.dependency_overrides[get_conversation_sink] = lambda: _NoopConversationSink()
    app.dependency_overrides[get_memory_sink] = lambda: _NoopMemorySink()


def _post_chat(client: TestClient, message: str, **body: Any) -> Any:
    payload = {"message": message, **body}
    return client.post("/chat", json=payload, headers=GOOD_HEADERS)


# ── /chat: happy path — tool_step then an approved, signable recommendation ─────


def test_chat_streams_toolstep_then_approved_recommendation(client: TestClient) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1)), _chain())
    resp = _post_chat(client, "where can I earn safe yield on my USDC?", conversationId="cnv_abc")

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(resp.text)

    # First record is a tool_step(running); every tool_step label is code-authored.
    assert events[0] == ("block", {"type": "tool_step", "label": "Understanding your request",
                                   "status": "running"})
    for block in _blocks(events):
        if block["type"] == "tool_step":
            assert block["label"] in _TOOL_LABELS

    recs = [b for b in _blocks(events) if b["type"] == "recommendation"]
    assert len(recs) == 2
    assert [r["rank"] for r in recs] == [1, 2]
    # Signable ONLY because the deterministic gate approved it.
    assert all(r["policy"]["status"] == "approved" for r in recs)
    assert all("checks" in r["policy"] for r in recs)
    assert all(r["proposedAction"]["type"] in {"vault_deposit", "aave_supply"} for r in recs)

    done = _done(events)
    assert done["conversationId"] == "cnv_abc"  # echoed back
    assert done["blockCount"] == len(_blocks(events))


def test_chat_mints_conversation_id_when_omitted(client: TestClient) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.OTHER)), _chain())
    resp = _post_chat(client, "hi there")
    done = _done(_parse_sse(resp.text))
    assert done["conversationId"].startswith("cnv_")


# ── /chat: out-of-policy proposal streams rejected + non-signable ───────────────


def test_chat_out_of_policy_action_is_rejected_and_non_signable(client: TestClient) -> None:
    # The "model" extracted an over-cap deposit (10,000 USDC vs a 5,000 USDC headroom).
    rogue = Intent(
        kind=IntentKind.BUILD_ACTION, action_type=ActionType.VAULT_DEPOSIT,
        asset=Asset.USDC, amount=10_000_000_000,
    )
    _wire(_dag(intent=rogue, mandate=MandateView(version=1)), _chain(per_user=5_000_000_000))
    resp = _post_chat(client, "deposit 10000 USDC")

    assert resp.status_code == 200
    blocks = _blocks(_parse_sse(resp.text))
    actions = [b for b in blocks if b["type"] == "action"]
    assert len(actions) == 1
    stamp = actions[0]["policy"]
    # Deterministic gate rejected it → rejected stamp, no checklist, no sign path.
    assert stamp["status"] == "rejected"
    assert "checks" not in stamp
    assert "reason" in stamp
    # A rogue proposal never becomes a signable recommendation, and nothing carries a signature.
    assert not any(b["type"] == "recommendation" for b in blocks)
    assert not any(_has_signature(b) for b in blocks)


def test_chat_never_returns_a_signable_bundle(client: TestClient) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1)), _chain())
    resp = _post_chat(client, "recommend a strategy")
    blocks = _blocks(_parse_sse(resp.text))
    # Even the approved recommendations carry only a ProposedAction + policy stamp — never a
    # signature/bundle. Materializing a signable IntentBundle is the /build-tx chokepoint.
    assert any(b["type"] == "recommendation" for b in blocks)
    assert not any(_has_signature(b) for b in blocks)


# ── /chat: malformed LLM output degrades to an inert block (fail-closed) ─────────


def test_chat_malformed_llm_output_degrades_to_inert_block(client: TestClient) -> None:
    # Planner returns no JSON (ok=False, not refused) → safe OTHER intent → the general/identity
    # branch, which now answers with a persona-bearing prose turn (025) instead of a canned line.
    _wire(_dag(planner_ok=False), _chain())
    resp = _post_chat(client, "%%% garbled $$$")

    assert resp.status_code == 200
    blocks = _blocks(_parse_sse(resp.text))
    types = [b["type"] for b in blocks]
    # understand(running/done) → general answer(running/done) → a single inert text block. The
    # branch returns before gather/propose/gate, so no action is ever built.
    assert types == ["tool_step", "tool_step", "tool_step", "tool_step", "text"]
    assert not any(b["type"] in {"recommendation", "action"} for b in blocks)
    # tool_step labels are code-authored (summarized trace), never raw model text/CoT.
    labels = {b["label"] for b in blocks if b["type"] == "tool_step"}
    assert labels == {"Understanding your request", "Thinking that through"}


def test_chat_general_question_answers_in_sparkys_voice(client: TestClient) -> None:
    # 025 · Task 1 — an identity/general turn is answered by the persona-bearing responder, NOT
    # the static help line, and it is structurally prose-only (no action/recommendation block can
    # come out of this branch, and nothing carries a signature).
    _wire(_dag(intent=Intent(kind=IntentKind.OTHER)), _chain())
    resp = _post_chat(client, "who are you?")

    assert resp.status_code == 200
    blocks = _blocks(_parse_sse(resp.text))
    texts = [b["markdown"] for b in blocks if b["type"] == "text"]
    assert texts == [SPARKY_ANSWER]
    assert not any(b["type"] in {"recommendation", "action"} for b in blocks)
    assert not any(_has_signature(b) for b in blocks)


def test_chat_planner_refusal_streams_refusal_error(client: TestClient) -> None:
    _wire(_dag(planner_refused=True), _chain())
    resp = _post_chat(client, "do something disallowed")
    blocks = _blocks(_parse_sse(resp.text))
    assert blocks[-1] == {"type": "error", "code": "REFUSAL",
                          "message": "I'm not able to help with that request."}
    assert not any(b["type"] in {"recommendation", "action"} for b in blocks)


# ── /chat: an unexpected mid-stream error fails closed to an inert error block ───


def test_chat_mid_stream_error_degrades_to_error_block(client: TestClient) -> None:
    dag = _dag(
        intent=Intent(kind=IntentKind.RECOMMEND),
        mandate=MandateView(version=1),
        portfolio=_ExplodingPortfolio(),  # gather() raises after the stream has started
    )
    _wire(dag, _chain())
    resp = _post_chat(client, "where can I earn yield?")

    assert resp.status_code == 200  # the stream had already started; degrade in-band
    events = _parse_sse(resp.text)
    blocks = _blocks(events)
    errors = [b for b in blocks if b["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["code"] == "UPSTREAM_UNAVAILABLE"
    # No traceback / partial action leaked; a done event still closes the stream.
    assert not any(b["type"] in {"recommendation", "action"} for b in blocks)
    assert _done(events)["blockCount"] == len(blocks)


# ── /chat: SSE framing + auth + validation ──────────────────────────────────────


def test_chat_sse_framing_uses_block_and_done_events(client: TestClient) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.LEARN, topic="what_is_apy")), _chain())
    resp = _post_chat(client, "what is APY?")
    text = resp.text
    assert "event: block\n" in text
    assert "event: done\n" in text
    # Every record is exactly one event line + one single-line data line.
    for record in [r for r in text.split("\n\n") if r.strip()]:
        lines = record.strip().splitlines()
        assert len(lines) == 2
        assert lines[0].startswith("event: ")
        assert lines[1].startswith("data: ")
    events = _parse_sse(text)
    assert events[-1][0] == "done"
    assert any(b["type"] == "tip" for b in _blocks(events))


def test_chat_requires_auth(client: TestClient) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.OTHER)), _chain())
    resp = client.post("/chat", json={"message": "hi"})  # no bearer token
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


def test_chat_empty_message_is_validation_error(client: TestClient) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.OTHER)), _chain())
    resp = _post_chat(client, "")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_chat_bad_surface_is_validation_error(client: TestClient) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.OTHER)), _chain())
    resp = client.post(
        "/chat", json={"message": "hi", "context": {"surface": "trading"}}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


# ── /chat/feedback ──────────────────────────────────────────────────────────────


def test_feedback_records_and_returns_204(client: TestClient) -> None:
    sink = _RecordingSink()
    app.dependency_overrides[get_feedback_sink] = lambda: sink
    resp = client.post(
        "/chat/feedback",
        json={"conversationId": "cnv_1", "blockId": "rec_1", "rating": "up"},
        headers=GOOD_HEADERS,
    )
    assert resp.status_code == 204
    assert resp.content == b""
    assert sink.calls == [("cnv_1", "rec_1", "up", None)]


def test_feedback_accepts_an_optional_reason(client: TestClient) -> None:
    """061 A9 — the rating is the signal; a reason is optional and must round-trip intact."""
    sink = _RecordingSink()
    app.dependency_overrides[get_feedback_sink] = lambda: sink
    resp = client.post(
        "/chat/feedback",
        json={
            "conversationId": "cnv_1",
            "blockId": "msg_7",
            "rating": "down",
            "reason": "too vague",
        },
        headers=GOOD_HEADERS,
    )
    assert resp.status_code == 204
    assert sink.calls == [("cnv_1", "msg_7", "down", "too vague")]


def test_feedback_bad_rating_is_validation_error(client: TestClient) -> None:
    resp = client.post(
        "/chat/feedback",
        json={"conversationId": "cnv_1", "blockId": "rec_1", "rating": "meh"},
        headers=GOOD_HEADERS,
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_feedback_requires_auth(client: TestClient) -> None:
    resp = client.post(
        "/chat/feedback", json={"conversationId": "c", "blockId": "b", "rating": "down"}
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


# ── 025 · Task 2: the streamed cards are PERSISTED, not just summarized ─────────


class _RecordingConversationSink(_NoopConversationSink):
    """Captures every ``record`` call so the terminal persist can be asserted end-to-end."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[tuple[str, str, list[dict[str, Any]]]] = []

    async def record(
        self,
        conversation_id: str,
        role: str,
        content: str,
        blocks: Any = None,
    ) -> None:
        self.records.append((role, content, [dict(b) for b in (blocks or [])]))

    def assistant(self) -> tuple[str, list[dict[str, Any]]]:
        (record,) = [r for r in self.records if r[0] == "assistant"]
        return record[1], record[2]


def _wire_recording_sink() -> _RecordingConversationSink:
    sink = _RecordingConversationSink()
    app.dependency_overrides[get_conversation_sink] = lambda: sink
    return sink


def test_chat_persists_card_wire_json_alongside_the_lossy_summary(client: TestClient) -> None:
    # The defect: reopening a conversation showed "[proposed action: aerodrome_swap]" because the
    # cards were never stored. Now the block wire rides along with the summary.
    _wire(
        _dag(
            intent=Intent(
                kind=IntentKind.BUILD_ACTION,
                action_type=ActionType.AERODROME_SWAP,
                asset=Asset.ETH,
                amount=10**16,
            )
        ),
        _chain(),
    )
    sink = _wire_recording_sink()
    _post_chat(client, "Swap ETH to USDC")

    summary, blocks = sink.assistant()
    # The lossy summary is KEPT (it feeds the classifier history + every pre-025 path)…
    assert summary == "[proposed action: aerodrome_swap]"
    # …and the real card is persisted next to it, in full.
    assert [b["type"] for b in blocks] == ["action"]
    assert blocks[0]["proposedAction"]["type"] == "aerodrome_swap"
    # The policy STAMP is persisted verbatim, so replay can never upgrade a rejected card.
    assert blocks[0]["policy"]["status"] == "rejected"


def test_chat_persists_the_user_turn_without_blocks(client: TestClient) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.OTHER)), _chain())
    sink = _wire_recording_sink()
    _post_chat(client, "who are you?")
    user = [r for r in sink.records if r[0] == "user"]
    assert user == [("user", "who are you?", [])]


def test_chat_never_persists_transient_tool_step_blocks(client: TestClient) -> None:
    # tool_step is thinking-state: emitted twice per step (running → done) and meaningless once
    # the turn is over. Replaying it would resurrect frozen progress spinners.
    _wire(_dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1)), _chain())
    sink = _wire_recording_sink()
    resp = _post_chat(client, "recommend something")

    streamed = {b["type"] for b in _blocks(_parse_sse(resp.text))}
    assert "tool_step" in streamed, "tool_step must still reach the LIVE stream"
    _summary, blocks = sink.assistant()
    assert blocks, "the recommendation cards themselves must be persisted"
    assert all(b["type"] != "tool_step" for b in blocks)
    assert any(b["type"] == "recommendation" for b in blocks)


def test_chat_never_persists_a_transient_stream_error(client: TestClient) -> None:
    # A mid-stream gateway blip is shown live but must not be etched into the thread forever.
    _wire(
        _dag(intent=Intent(kind=IntentKind.PORTFOLIO), portfolio=_ExplodingPortfolio()), _chain()
    )
    sink = _wire_recording_sink()
    resp = _post_chat(client, "show me my portfolio")

    streamed = _blocks(_parse_sse(resp.text))
    assert any(b["type"] == "error" for b in streamed), "the error must reach the LIVE stream"
    assert all(b["type"] != "error" for _r, _c, bl in sink.records for b in bl)


def test_chat_persists_a_portfolio_snapshot_card(client: TestClient) -> None:
    view = PortfolioView(
        positions=(PositionLite(venue="Wallet (idle)", asset="USDC", value_usd="50.00"),),
        net_worth_usd="50.00",
        idle_usdc=50_000_000,
    )
    _wire(_dag(intent=Intent(kind=IntentKind.PORTFOLIO), portfolio=_Portfolio(view)), _chain())
    sink = _wire_recording_sink()
    _post_chat(client, "what's in my wallet?")

    summary, blocks = sink.assistant()
    assert "[showed your portfolio]" in summary
    types = [b["type"] for b in blocks]
    assert types == ["portfolio_snapshot", "text"]
    assert blocks[0]["positions"][0]["venue"] == "Wallet (idle)"


# ── 027 · Wave 4: the cross-conversation memory read + write path ───────────────


class _RecordingMemorySink(_NoopMemorySink):
    """Captures the digest handed to the DAG and every line written back."""

    def __init__(self, seeded: list[str] | None = None) -> None:
        super().__init__()
        self.seeded = seeded or []
        self.reads: list[str] = []
        self.writes: list[tuple[str, list[str]]] = []

    async def lines(self, owner_eoa: str) -> list[str]:
        self.reads.append(owner_eoa)
        return list(self.seeded)

    async def remember(self, owner_eoa: str, lines: Any) -> None:
        self.writes.append((owner_eoa, list(lines)))


def _wire_memory(seeded: list[str] | None = None) -> _RecordingMemorySink:
    sink = _RecordingMemorySink(seeded)
    app.dependency_overrides[get_memory_sink] = lambda: sink
    return sink


def test_chat_remembers_the_question_and_the_recommendation_it_produced(
    client: TestClient,
) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1)), _chain())
    memory = _wire_memory()
    _post_chat(client, "where can I earn yield?")

    assert len(memory.writes) == 1
    owner, lines = memory.writes[0]
    assert owner == OWNER, "memory is keyed to the WALLET, not the conversation"
    assert lines[0] == "asked: where can I earn yield?"
    assert lines[1].startswith("was recommended: ")


def test_chat_remembers_a_portfolio_view(client: TestClient) -> None:
    view = PortfolioView(
        positions=(PositionLite(venue="Wallet (idle)", asset="USDC", value_usd="50.00"),),
        net_worth_usd="50.00",
        idle_usdc=50_000_000,
    )
    _wire(_dag(intent=Intent(kind=IntentKind.PORTFOLIO), portfolio=_Portfolio(view)), _chain())
    memory = _wire_memory()
    _post_chat(client, "what's in my wallet?")
    assert memory.writes[0][1] == ["asked: what's in my wallet?", "viewed portfolio"]


def test_chat_reads_the_digest_for_the_session_wallet_before_streaming(
    client: TestClient,
) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.OTHER)), _chain())
    memory = _wire_memory(["asked: what is APY?", "viewed portfolio"])
    resp = _post_chat(client, "what did we do last time?")
    assert resp.status_code == 200
    assert memory.reads == [OWNER]


class _ExplodingStore:
    """A MemoryStore whose every call fails, as a dead pool or a pre-0030 database would."""

    async def get(self, owner_eoa: str) -> Any:
        raise RuntimeError("pool is down")

    async def append(self, owner_eoa: str, lines: Any) -> None:
        raise RuntimeError("pool is down")


def test_a_broken_memory_store_never_breaks_the_chat_turn(client: TestClient) -> None:
    # FAIL-OPEN, exactly like the conversation sink, and asserted through the PRODUCTION sink
    # rather than a stand-in — the swallow lives in `_MemorySink`, so that is what has to hold.
    # A memory outage costs context, never a chat turn (and never custody, N2).
    _wire(_dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1)), _chain())
    app.dependency_overrides[get_memory_sink] = lambda: _MemorySink(_ExplodingStore())  # type: ignore[arg-type]
    resp = _post_chat(client, "where can I earn yield?")
    assert resp.status_code == 200
    blocks = _blocks(_parse_sse(resp.text))
    assert any(b["type"] == "recommendation" for b in blocks), "the turn still streamed its cards"
    assert all(b["type"] != "error" for b in blocks), "and produced no error block"


async def test_a_broken_memory_read_degrades_to_no_memory() -> None:
    sink = _MemorySink(_ExplodingStore())  # type: ignore[arg-type]
    assert await sink.lines(OWNER) == [], "a failed read is 'no memory', not an exception"


# ── 028 · the platform-activity fold at turn start ──────────────────────────────


class _FoldRecordingSink(_RecordingMemorySink):
    """Also records fold calls and their order relative to the digest read."""

    def __init__(self) -> None:
        super().__init__()
        self.sequence: list[str] = []
        self.folds: list[tuple[str, str, int]] = []

    async def fold_platform_activity(self, *, owner: str, account: str, chain_id: int) -> None:
        self.sequence.append("fold")
        self.folds.append((owner, account, chain_id))

    async def lines(self, owner_eoa: str) -> list[str]:
        self.sequence.append("read")
        return await super().lines(owner_eoa)


def test_chat_folds_platform_activity_once_before_reading_the_digest(
    client: TestClient,
) -> None:
    _wire(_dag(intent=Intent(kind=IntentKind.OTHER)), _chain())
    sink = _FoldRecordingSink()
    app.dependency_overrides[get_memory_sink] = lambda: sink
    resp = _post_chat(client, "hello")
    assert resp.status_code == 200
    assert sink.folds == [(OWNER, USER, 8453)], "fold keyed by session identity + chain"
    assert sink.sequence[:2] == ["fold", "read"], "fold runs BEFORE the digest read"


def test_a_broken_activity_folder_never_breaks_the_chat_turn(client: TestClient) -> None:
    # Through the PRODUCTION sink: the folder factory itself explodes — worse than any store
    # failure — and the turn still streams its cards with zero error blocks (FR-007/SC-006).
    def _bomb(chain_id: int) -> Any:
        raise RuntimeError("factory exploded")

    _wire(_dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1)), _chain())
    app.dependency_overrides[get_memory_sink] = lambda: _MemorySink(
        _ExplodingStore(),  # type: ignore[arg-type]
        folder_factory=_bomb,
    )
    resp = _post_chat(client, "where can I earn yield?")
    assert resp.status_code == 200
    blocks = _blocks(_parse_sse(resp.text))
    assert any(b["type"] == "recommendation" for b in blocks)
    assert all(b["type"] != "error" for b in blocks)


async def test_fold_failures_warn_exactly_once_per_process(
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    import sparkpoint_agent.api.chat as chat_module

    chat_module._warned_fold_failure = False
    try:

        def _bomb(chain_id: int) -> Any:
            raise RuntimeError("factory exploded")

        sink = _MemorySink(_ExplodingStore(), folder_factory=_bomb)  # type: ignore[arg-type]
        with caplog.at_level(logging.WARNING, logger=chat_module.__name__):
            for _ in range(3):
                await sink.fold_platform_activity(owner=OWNER, account=OWNER, chain_id=84532)
        hits = [r for r in caplog.records if "user_memory_fold_failed" in r.getMessage()]
        assert len(hits) == 1
    finally:
        chat_module._warned_fold_failure = False


def test_every_activity_source_down_still_streams_a_clean_turn(client: TestClient) -> None:
    # SC-006 second half: memory store, flow reader, exec store, swap store AND the faucet probe
    # all raising — the fold degrades to memory v1 and the turn is indistinguishable from normal.
    from sparkpoint_agent.activity_fold import ActivityFolder
    from sparkpoint_agent.db.user_memory import MemoryStore as _RealMemoryStore

    class _EvilEverything:
        def __getattr__(self, name: str) -> Any:
            async def _boom(*args: Any, **kwargs: Any) -> Any:
                raise RuntimeError("everything is down")

            return _boom

    def _factory(chain_id: int) -> ActivityFolder:
        evil = _EvilEverything()
        return ActivityFolder(
            memory=cast(_RealMemoryStore, evil),
            flows=cast(Any, evil),
            flow_targets=(("base", VAULT),),
            executions=cast(Any, evil),
            swaps=cast(Any, evil),
            swap_networks=("base",),
            faucet_probe=cast(Any, evil),
        )

    _wire(_dag(intent=Intent(kind=IntentKind.RECOMMEND), mandate=MandateView(version=1)), _chain())
    app.dependency_overrides[get_memory_sink] = lambda: _MemorySink(
        _ExplodingStore(),  # type: ignore[arg-type]
        folder_factory=_factory,
    )
    resp = _post_chat(client, "where can I earn yield?")
    assert resp.status_code == 200
    blocks = _blocks(_parse_sse(resp.text))
    assert any(b["type"] == "recommendation" for b in blocks)
    assert all(b["type"] != "error" for b in blocks)
