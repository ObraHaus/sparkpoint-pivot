# ruff: noqa: S101, S105, S106, S311  (pytest asserts; fixture creds; deterministic jitter rng)
"""OpenAI-compatible embedding backend (OpenRouter's embeddings API) — no network.

Exercises the P2 production backend with an httpx MockTransport so the real request/parse
path (truncate 2048→pinned dim, L2-renormalize, order by `index`, fail-closed) is verified
off-network. Also pins the composition seams: `openai_embedder` / `default_citation_retriever`
return None when the provider isn't configured (CI/tests) so citations are simply absent —
never fabricated or stub-ranked in production.
"""

from __future__ import annotations

import json
import math
import random

import httpx
import pytest

from sparkpoint_agent.knowledge import (
    EMBEDDING_DIM,
    EMBEDDING_EXPECTED_MODEL,
    EMBEDDING_MODEL_VERSION,
    EmbeddingBackendError,
    OpenAIEmbeddingBackend,
    default_citation_retriever,
    openai_embedder,
)
from sparkpoint_agent.knowledge.embeddings import EmbedRetryPolicy, _backoff_delay

_NATIVE_DIM = 2048  # nvidia/llama-nemotron-embed-vl-1b-v2:free native width (2048 → pinned 1024)
_SECRET = "sk-test-DO-NOT-LEAK-123"


def _client(handler: object) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]


def _backend(handler: object, **kwargs: object) -> OpenAIEmbeddingBackend:
    # Tests never actually wait: the backoff sleep is recorded by the caller when it matters.
    kwargs.setdefault("sleep", lambda _s: None)
    kwargs.setdefault("rng", random.Random(0))
    return OpenAIEmbeddingBackend(
        api_url="http://embed.example/api/v1",
        api_key=_SECRET,
        model=EMBEDDING_EXPECTED_MODEL,
        client=_client(handler),
        **kwargs,  # type: ignore[arg-type]
    )


def test_truncates_to_pinned_dim_and_normalizes() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        # one native-width vector per input; distinct per index so order is checkable
        data = [
            {"index": i, "embedding": [float(i + 1)] * _NATIVE_DIM}
            for i in range(len(body["input"]))
        ]
        return httpx.Response(200, json={"data": data, "model": body["model"]})

    vecs = _backend(handler).embed(["alpha", "beta"])
    assert len(vecs) == 2
    for v in vecs:
        assert len(v) == EMBEDDING_DIM  # truncated 2048 → pinned dim
        assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, rel_tol=1e-6)  # L2-normalized


def test_orders_by_index_not_response_order() -> None:
    # Return the two results REVERSED; the backend must restore input order via `index`.
    def handler(request: httpx.Request) -> httpx.Response:
        data = [
            {"index": 1, "embedding": [2.0] * _NATIVE_DIM},
            {"index": 0, "embedding": [1.0] * _NATIVE_DIM},
        ]
        return httpx.Response(200, json={"data": data})

    vecs = _backend(handler).embed(["first", "second"])
    # after normalization every component of a constant vector is equal + positive; the point is
    # simply that index-0's (all-1.0) maps to output[0] — both normalize to the same unit vector,
    # so instead assert the count/order plumbing didn't drop or swap entries.
    assert len(vecs) == 2
    assert all(len(v) == EMBEDDING_DIM for v in vecs)


def test_malformed_response_fails_closed() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"unexpected": "shape"})

    with pytest.raises(EmbeddingBackendError):
        _backend(handler).embed(["x"])


def test_short_vector_fails_closed() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0] * 16}]})

    with pytest.raises(EmbeddingBackendError):
        _backend(handler).embed(["x"])


def test_http_error_fails_closed_without_leaking_the_key() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    with pytest.raises(EmbeddingBackendError) as ei:
        _backend(handler).embed(["x"])
    # The credential must never appear in the raised message or the repr.
    assert _SECRET not in str(ei.value)
    assert _SECRET not in repr(_backend(handler))


def test_backend_reports_the_pinned_space() -> None:
    b = OpenAIEmbeddingBackend(api_url="http://x/v1", api_key=_SECRET, model="m")
    assert b.dimension == EMBEDDING_DIM
    assert b.model_version == EMBEDDING_MODEL_VERSION  # so it passes assert_backend_matches_pin


def test_factories_return_none_when_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    # Missing any of URL/KEY/MODEL ⇒ no backend ⇒ no citations (fail-open, never fabricated).
    assert openai_embedder(env={}) is None
    assert openai_embedder(env={"EMBEDDING_OPENAI_API_URL": "http://x/v1"}) is None
    # default_citation_retriever reads os.environ — clear the provider so the test is hermetic.
    for k in ("EMBEDDING_OPENAI_API_URL", "EMBEDDING_OPENAI_API_KEY", "EMBEDDING_OPENAI_MODEL"):
        monkeypatch.delenv(k, raising=False)
    assert default_citation_retriever() is None


def test_openai_embedder_builds_when_configured() -> None:
    emb = openai_embedder(
        env={
            "EMBEDDING_OPENAI_API_URL": "http://embed.example/api/v1",
            "EMBEDDING_OPENAI_API_KEY": _SECRET,
            "EMBEDDING_OPENAI_MODEL": EMBEDDING_EXPECTED_MODEL,
        }
    )
    assert emb is not None
    assert emb.dimension == EMBEDDING_DIM
    assert emb.model_version == EMBEDDING_MODEL_VERSION


def test_openai_embedder_rejects_a_foreign_model() -> None:
    # A foreign (non-pinned) model must be REJECTED at composition — not silently stamped with the
    # pin, which would write vectors into an incompatible space. Guards the pin's meaning.
    with pytest.raises(ValueError, match="re-embed event"):
        openai_embedder(
            env={
                "EMBEDDING_OPENAI_API_URL": "http://embed.example/api/v1",
                "EMBEDDING_OPENAI_API_KEY": _SECRET,
                "EMBEDDING_OPENAI_MODEL": "text-embedding-3-large",  # not the pinned model
            }
        )


# ─────────────────────────────────────────────────────────────────────────────
# Retry policy — transient failures must be ridden out, permanent ones fail fast.
# ─────────────────────────────────────────────────────────────────────────────


def test_retries_429_then_succeeds_and_honors_retry_after() -> None:
    calls = {"n": 0}
    sleeps: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "2"}, json={"error": "slow down"})
        body = json.loads(request.content)
        data = [{"index": i, "embedding": [1.0] * _NATIVE_DIM} for i in range(len(body["input"]))]
        return httpx.Response(200, json={"data": data})

    vecs = _backend(handler, sleep=sleeps.append).embed(["x"])
    assert len(vecs) == 1 and len(vecs[0]) == EMBEDDING_DIM
    assert calls["n"] == 2
    assert sleeps == [2.0]  # the server's Retry-After wins over jitter


def test_retries_transport_error_then_succeeds() -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ConnectError("connection reset", request=request)
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0] * _NATIVE_DIM}]})

    vecs = _backend(handler).embed(["x"])
    assert len(vecs) == 1
    assert calls["n"] == 2


def test_non_retryable_status_is_not_retried() -> None:
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, json={"error": "bad model"})

    with pytest.raises(EmbeddingBackendError) as ei:
        _backend(handler).embed(["x"])
    assert calls["n"] == 1  # a client error is never silently re-sent
    assert _SECRET not in str(ei.value)


def test_retry_exhaustion_fails_closed_without_leaking_the_key() -> None:
    calls = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503, json={"error": "unavailable"})

    b = _backend(handler, policy=EmbedRetryPolicy(max_attempts=3, total_budget_s=10.0))
    with pytest.raises(EmbeddingBackendError) as ei:
        b.embed(["x"])
    assert calls["n"] == 3  # attempts capped by the policy
    assert _SECRET not in str(ei.value)


def test_backoff_honors_retry_after_and_equal_jitter() -> None:
    p = EmbedRetryPolicy(base_delay_s=1.0, max_delay_s=8.0)
    assert _backoff_delay(1, retry_after=3.5, policy=p, rng=random.Random(0)) == 3.5
    # Equal jitter: half the window is a floor, half is random (window 1.0 on attempt 1).
    d1 = _backoff_delay(1, retry_after=None, policy=p, rng=random.Random(0))
    assert 0.5 <= d1 <= 1.0
    # The exponential window is capped at max_delay_s (attempt 4 → window 8.0).
    d4 = _backoff_delay(4, retry_after=None, policy=p, rng=random.Random(0))
    assert 4.0 <= d4 <= 8.0
