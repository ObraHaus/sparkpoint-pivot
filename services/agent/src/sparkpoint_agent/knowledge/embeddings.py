"""T124 — the SHARED, version-pinned embedding utility.

ONE pinned model id, ONE ``embed(texts) -> vectors`` interface, used by BOTH
operational memory AND (later) the Obsidian tier so the two tiers never diverge.

Grounding
---------
research.md §7 (Postgres + pgvector, "Memory, Outcomes, Embeddings"):
  - "store ``embedding_model_version`` alongside each vector; never mix
    dimensions/models silently."
  - "Safe default: a single pinned embedding model at MVP; on a model change,
    re-embed in a backfill job rather than query across mixed spaces."
data-model.md §17 (``memory_embeddings(user_id, kind, embedding, payload, …)``)
  — the ``vector(EMBEDDING_DIM)`` column MUST match ``EMBEDDING_DIM`` below.

Design
------
- ``EMBEDDING_MODEL_VERSION`` / ``EMBEDDING_DIM`` are the SINGLE source of truth
  for the pinned space. The pgvector migration column width and every stored
  ``embedding_model_version`` derive from these two constants — do not hardcode
  the number elsewhere.
- The concrete embedding provider is a **deferred Gate decision** (research.md §7
  open question — "Candidate: a hosted embedding API; final choice deferred to
  implementation"), so the network-calling backend is injected behind the
  ``EmbeddingBackend`` protocol. The provider is swappable WITHOUT changing this
  interface; swapping it is exactly what bumps ``EMBEDDING_MODEL_VERSION``.
- **Re-embed-on-change invariant.** Because a single pinned space spans BOTH
  tiers, changing ``EMBEDDING_MODEL_VERSION`` (new provider, new model, new
  dimension) requires a backfill that re-embeds EVERY row in EVERY tier
  (operational memory + Obsidian). Never write a new-version vector next to an
  old-version vector and compare distances across them — that is the
  "mixed space" failure §7 forbids. ``embedding_model_version`` is stamped per
  row precisely so a backfill can find and replace the stale space.
- Fail-closed: a backend that returns the wrong count or the wrong dimension
  raises rather than silently persisting a malformed/mismatched vector.
"""

from __future__ import annotations

import hashlib
import math
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx

# ─────────────────────────────────────────────────────────────────────────────
# The pinned space (single source of truth). research.md §7.
# ─────────────────────────────────────────────────────────────────────────────

# The version-pinned embedding model id stamped onto every row of BOTH tiers.
# The provider Gate decision (research.md §7) is RESOLVED: the operator's self-hosted,
# Qwen3-Embedding-8B (MRL) over an OpenAI-compatible endpoint, truncated (MRL) to the pinned
# 1024-dim. Provider is now OpenRouter (the prior self-hosted OpenWebUI dropped the model). It is
# the SAME model + 1024-MRL space, so this version id is UNCHANGED (existing vectors stay
# compatible — NO re-embed). The id encodes model + effective dim so a distance query won't cross a
# boundary; bumping it remains a re-embed event (see module docstring).
EMBEDDING_MODEL_VERSION = "qwen3-embedding-8b-mrl1024@2026.07.0"

# The vector dimension of the pinned space. MUST equal the pgvector
# ``vector(N)`` column width in the memory_embeddings migration (data-model.md
# §17). Changing this is a re-embed event.
EMBEDDING_DIM = 1024

# The EXACT provider model the pin above represents. The env's EMBEDDING_OPENAI_MODEL must equal
# this, else composition is REJECTED — otherwise any OpenAI-compatible endpoint (a foreign model
# that merely returns ≥1024 dims) would be silently stamped with the qwen3 pin and write vectors
# into an incompatible space. This is OpenRouter's id for Qwen3-Embedding-8B (same model +
# 1024-MRL space as before). Switching to a DIFFERENT model = change BOTH this and
# EMBEDDING_MODEL_VERSION and re-embed the corpus (a version boundary, by design).
EMBEDDING_EXPECTED_MODEL = "qwen/qwen3-embedding-8b"


class EmbeddingDimensionError(ValueError):
    """A backend returned a vector whose dimension ≠ the pinned ``EMBEDDING_DIM``.

    Raised fail-closed so a malformed vector never reaches pgvector, where a
    width mismatch would either error at insert or silently corrupt a search.
    """


class EmbeddingCountError(ValueError):
    """A backend returned a vector count ≠ the number of input texts (fail-closed)."""


# ─────────────────────────────────────────────────────────────────────────────
# Backend seam — the network-calling provider (deferred choice) plugs in here.
# ─────────────────────────────────────────────────────────────────────────────


@runtime_checkable
class EmbeddingBackend(Protocol):
    """The pluggable embedding provider (hosted API, local model, …).

    A backend owns the two facts that define its vector space — its
    ``model_version`` and its ``dimension`` — and turns text into raw vectors.
    Stamping and validation are the ``Embedder``'s job, not the backend's.
    """

    @property
    def model_version(self) -> str:
        """The version id this backend produces (e.g. the hosted model @ date)."""
        ...

    @property
    def dimension(self) -> int:
        """The fixed length of every vector this backend returns."""
        ...

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Return one vector per input text, in input order."""
        ...


@dataclass(frozen=True)
class Embedding:
    """One embedded row: the vector PLUS the pinned version it was produced under.

    ``model_version`` travels with the vector to its storage row
    (``memory_embeddings.embedding_model_version``, data-model.md §17) so a later
    backfill can detect a stale space and re-embed it (research.md §7).
    """

    vector: tuple[float, ...]
    model_version: str

    @property
    def dimension(self) -> int:
        return len(self.vector)


class Embedder:
    """The one embedding interface both memory tiers call.

    Wraps a version-pinned ``EmbeddingBackend`` and, for every text, returns an
    ``Embedding`` carrying the vector + the backend's ``model_version``. Enforces
    the count- and dimension-invariants fail-closed.
    """

    def __init__(self, backend: EmbeddingBackend) -> None:
        self._backend = backend

    @property
    def model_version(self) -> str:
        return self._backend.model_version

    @property
    def dimension(self) -> int:
        return self._backend.dimension

    def embed(self, texts: Sequence[str]) -> list[Embedding]:
        """Embed ``texts`` → one stamped ``Embedding`` each, in input order.

        Empty input returns ``[]`` (no backend round-trip). Any count- or
        dimension-mismatch raises rather than persisting a malformed row.
        """
        if len(texts) == 0:
            return []

        raw = self._backend.embed(texts)

        if len(raw) != len(texts):
            raise EmbeddingCountError(
                f"backend returned {len(raw)} vectors for {len(texts)} texts"
            )

        version = self._backend.model_version
        expected_dim = self._backend.dimension
        out: list[Embedding] = []
        for i, vec in enumerate(raw):
            if len(vec) != expected_dim:
                raise EmbeddingDimensionError(
                    f"vector {i} has dimension {len(vec)}, expected {expected_dim} "
                    f"(model {version})"
                )
            out.append(Embedding(vector=tuple(vec), model_version=version))
        return out

    def embed_one(self, text: str) -> Embedding:
        """Convenience for a single text (e.g. a query vector for a search)."""
        return self.embed([text])[0]


def assert_backend_matches_pin(backend: EmbeddingBackend) -> None:
    """Startup guard: a PRODUCTION backend must match the pinned space exactly.

    Wire this at composition so a misconfigured provider (wrong model, wrong
    width) fails at boot instead of quietly writing vectors into the wrong space
    (the "mixed space" hazard, research.md §7). The offline stub deliberately
    does NOT match the pin and must never pass this check in production.
    """
    if backend.model_version != EMBEDDING_MODEL_VERSION:
        raise ValueError(
            f"embedding backend model_version {backend.model_version!r} != pinned "
            f"{EMBEDDING_MODEL_VERSION!r}; a version change is a re-embed event"
        )
    if backend.dimension != EMBEDDING_DIM:
        raise EmbeddingDimensionError(
            f"embedding backend dimension {backend.dimension} != pinned {EMBEDDING_DIM}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Offline stub backend — deterministic, network-free. FOR DEV/TESTS ONLY.
# ─────────────────────────────────────────────────────────────────────────────

# A version tag that is intentionally DISTINCT from EMBEDDING_MODEL_VERSION so a
# stub vector can never be mistaken for a production vector, and so
# ``assert_backend_matches_pin`` rejects the stub in production.
_STUB_MODEL_VERSION = "stub-hash-v0"


class _DeterministicStubBackend:
    """A network-free, deterministic ``EmbeddingBackend`` for offline dev/tests.

    NOT semantically meaningful — it maps text→vector via a hash so the
    ``Embedder`` interface, the stamping, and the pgvector plumbing can be
    exercised without a live embedding API. It reports a distinct
    ``model_version`` so it is never confused with a real space.
    """

    def __init__(self, dimension: int = EMBEDDING_DIM) -> None:
        if dimension <= 0:
            raise ValueError("stub embedding dimension must be positive")
        self._dimension = dimension

    @property
    def model_version(self) -> str:
        return _STUB_MODEL_VERSION

    @property
    def dimension(self) -> int:
        return self._dimension

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._hash_vector(t) for t in texts]

    def _hash_vector(self, text: str) -> list[float]:
        values: list[float] = []
        counter = 0
        while len(values) < self._dimension:
            digest = hashlib.sha256(f"{counter}:{text}".encode()).digest()
            for start in range(0, len(digest), 4):
                if len(values) >= self._dimension:
                    break
                chunk = int.from_bytes(digest[start : start + 4], "big")
                # map uint32 -> [-1, 1)
                values.append((chunk / 2**32) * 2.0 - 1.0)
            counter += 1
        norm = math.sqrt(sum(v * v for v in values)) or 1.0
        return [v / norm for v in values]


def stub_embedder(dimension: int = EMBEDDING_DIM) -> Embedder:
    """An ``Embedder`` over the deterministic offline stub. DEV/TESTS ONLY."""
    return Embedder(_DeterministicStubBackend(dimension))


# ─────────────────────────────────────────────────────────────────────────────
# Production backend — the operator's OpenAI-compatible OpenWebUI endpoint.
# ─────────────────────────────────────────────────────────────────────────────

# The env the knowledge tier (NOT the keyless config.py) reads for the provider.
EMBEDDING_API_URL_ENV = "EMBEDDING_OPENAI_API_URL"
EMBEDDING_API_KEY_ENV = "EMBEDDING_OPENAI_API_KEY"  # noqa: S105 — env NAME, not a secret value
EMBEDDING_MODEL_ENV = "EMBEDDING_OPENAI_MODEL"


class EmbeddingBackendError(RuntimeError):
    """The embedding provider failed or returned a malformed response (fail-closed).

    Its message NEVER contains the request URL, headers, or the API key — only a coarse,
    non-leaking cause — so a logged/propagated error can never expose the credential.
    """


def _l2_normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


class OpenAIEmbeddingBackend:
    """An OpenAI-compatible :class:`EmbeddingBackend` (OpenRouter's embeddings API).

    POSTs ``{model, input}`` to ``<api_url>/embeddings`` with a Bearer key and reads the OpenAI
    ``data[].embedding`` shape (ordered by ``index``). The model (``qwen/qwen3-embedding-8b``) is
    MRL-trained and returns 4096-dim vectors even when a ``dimensions`` hint is sent, so each
    vector is TRUNCATED to the pinned :data:`EMBEDDING_DIM` (a valid Matryoshka sub-embedding)
    and L2-renormalized — matching the pgvector column width with no re-migration.

    SECRET: the API key is held in-instance and set ONLY on the outgoing ``Authorization``
    header; it is NEVER logged, embedded in an exception message, or shown in this repr.
    """

    def __init__(
        self,
        *,
        api_url: str,
        api_key: str,
        model: str,
        dimension: int = EMBEDDING_DIM,
        model_version: str = EMBEDDING_MODEL_VERSION,
        timeout: float = 60.0,
        client: httpx.Client | None = None,
    ) -> None:
        self._url = api_url.rstrip("/") + "/embeddings"
        self._key = api_key  # secret — never logged
        self._model = model
        self._dimension = dimension
        self._model_version = model_version
        self._timeout = timeout
        self._client = client  # injectable for tests (a MockTransport client)

    def __repr__(self) -> str:  # never leak the key via repr
        return f"OpenAIEmbeddingBackend(model={self._model!r}, dim={self._dimension})"

    @property
    def model_version(self) -> str:
        return self._model_version

    @property
    def dimension(self) -> int:
        return self._dimension

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        payload = {"model": self._model, "input": list(texts)}
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
        }
        try:
            if self._client is not None:
                resp = self._client.post(self._url, json=payload, headers=headers)
            else:
                resp = httpx.post(self._url, json=payload, headers=headers, timeout=self._timeout)
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError as exc:
            # `from None` + bare class name: the httpx repr can carry the request URL — never
            # chain it, so nothing that could hint at the endpoint/credential leaks.
            raise EmbeddingBackendError(
                f"embedding request failed: {type(exc).__name__}"
            ) from None

        items = data.get("data") if isinstance(data, dict) else None
        if not isinstance(items, list) or len(items) != len(texts):
            raise EmbeddingBackendError("embedding response malformed (missing or short data[])")
        ordered = sorted(items, key=lambda it: it.get("index", 0))
        out: list[list[float]] = []
        for it in ordered:
            vec = it.get("embedding")
            if not isinstance(vec, list) or len(vec) < self._dimension:
                raise EmbeddingBackendError(
                    "embedding vector missing or shorter than the pinned dimension"
                )
            # MRL truncation to the pinned width + renormalize (valid for qwen3-embedding).
            out.append(_l2_normalize([float(x) for x in vec[: self._dimension]]))
        return out


def openai_embedder(env: Mapping[str, str] | None = None) -> Embedder | None:
    """Build the production :class:`Embedder` from ``EMBEDDING_OPENAI_*``, or ``None`` if unset.

    Returns ``None`` when the provider isn't configured (e.g. CI/tests) so callers wire the
    knowledge retriever ONLY when a real backend exists — otherwise citations are simply
    absent (fail-open, never fabricated). When configured, the backend is checked against the
    pinned space (:func:`assert_backend_matches_pin`) so a misconfigured model/dim fails fast.
    """
    src = env if env is not None else os.environ
    url = (src.get(EMBEDDING_API_URL_ENV) or "").strip()
    key = (src.get(EMBEDDING_API_KEY_ENV) or "").strip()
    model = (src.get(EMBEDDING_MODEL_ENV) or "").strip()
    if not (url and key and model):
        return None
    # NON-TAUTOLOGICAL pin check: the configured model must be the exact model the pin represents.
    # (`assert_backend_matches_pin` alone can't catch this — the backend reports the pin regardless
    # of its model — so a foreign ≥1024-dim endpoint would otherwise be stamped qwen3 silently.)
    if model != EMBEDDING_EXPECTED_MODEL:
        raise ValueError(
            f"EMBEDDING_OPENAI_MODEL {model!r} != pinned {EMBEDDING_EXPECTED_MODEL!r} "
            f"(space {EMBEDDING_MODEL_VERSION!r}); a model change is a re-embed event, "
            f"refusing to write into a mismatched vector space"
        )
    backend = OpenAIEmbeddingBackend(api_url=url, api_key=key, model=model)
    assert_backend_matches_pin(backend)
    return Embedder(backend)
