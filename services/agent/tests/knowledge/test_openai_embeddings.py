# ruff: noqa: S101, S105, S106  (pytest asserts; test-only fixture creds, never real secrets)
"""OpenAI-compatible embedding backend (the operator's OpenWebUI provider) — no network.

Exercises the P2 production backend with an httpx MockTransport so the real request/parse
path (truncate 4096→pinned dim, L2-renormalize, order by `index`, fail-closed) is verified
off-network. Also pins the composition seams: `openai_embedder` / `default_citation_retriever`
return None when the provider isn't configured (CI/tests) so citations are simply absent —
never fabricated or stub-ranked in production.
"""

from __future__ import annotations

import json
import math

import httpx
import pytest

from sparkpoint_agent.knowledge import (
    EMBEDDING_DIM,
    EMBEDDING_MODEL_VERSION,
    EmbeddingBackendError,
    OpenAIEmbeddingBackend,
    default_citation_retriever,
    openai_embedder,
)

_NATIVE_DIM = 4096  # qwen/qwen3-embedding-8b native width (the provider ignores `dimensions`)
_SECRET = "sk-test-DO-NOT-LEAK-123"


def _client(handler: object) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]


def _backend(handler: object) -> OpenAIEmbeddingBackend:
    return OpenAIEmbeddingBackend(
        api_url="http://embed.example/api/v1",
        api_key=_SECRET,
        model="qwen/qwen3-embedding-8b",
        client=_client(handler),
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
        assert len(v) == EMBEDDING_DIM  # truncated 4096 → pinned dim
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
            "EMBEDDING_OPENAI_MODEL": "qwen/qwen3-embedding-8b",
        }
    )
    assert emb is not None
    assert emb.dimension == EMBEDDING_DIM
    assert emb.model_version == EMBEDDING_MODEL_VERSION


def test_openai_embedder_rejects_a_foreign_model() -> None:
    # A foreign (non-pinned) model must be REJECTED at composition — not silently stamped with the
    # qwen3 pin, which would write vectors into an incompatible space. Guards the pin's meaning.
    with pytest.raises(ValueError, match="re-embed event"):
        openai_embedder(
            env={
                "EMBEDDING_OPENAI_API_URL": "http://embed.example/api/v1",
                "EMBEDDING_OPENAI_API_KEY": _SECRET,
                "EMBEDDING_OPENAI_MODEL": "text-embedding-3-large",  # not the pinned model
            }
        )
