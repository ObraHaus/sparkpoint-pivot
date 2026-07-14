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
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender, _Rank
from sparkpoint_agent.api.chat import (
    get_chain_provider,
    get_coordinator_dag,
    get_feedback_sink,
)
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
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
    "Reading your portfolio",
    "Checking strategies against your guardrails",
}


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
        self.calls: list[tuple[str, str, str]] = []

    async def record(
        self, *, conversation_id: str, block_id: str, rating: str, account: AccountContext
    ) -> None:
        self.calls.append((conversation_id, block_id, rating))


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
    # Planner returns no JSON (ok=False, not refused) → safe OTHER intent → general help text.
    _wire(_dag(planner_ok=False), _chain())
    resp = _post_chat(client, "%%% garbled $$$")

    assert resp.status_code == 200
    blocks = _blocks(_parse_sse(resp.text))
    types = [b["type"] for b in blocks]
    # tool_step(running) → tool_step(done) → a single inert text block; no action ever built.
    assert types == ["tool_step", "tool_step", "text"]
    assert not any(b["type"] in {"recommendation", "action"} for b in blocks)
    # tool_step labels are code-authored (summarized trace), never raw model text/CoT.
    labels = {b["label"] for b in blocks if b["type"] == "tool_step"}
    assert labels == {"Understanding your request"}


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
    assert sink.calls == [("cnv_1", "rec_1", "up")]


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
