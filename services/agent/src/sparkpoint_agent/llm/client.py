"""Async Claude client — the mockable LLM boundary the W6 agents call through.

This is the async counterpart to the sync ``claude.ClaudeClient`` (research.md §6).
The W6 advisory agents (planner / recommender / literacy) and the Coordinator DAG
run in FastAPI's async event loop, so they need a non-blocking client; and their
unit tests must NEVER touch the network. Both needs are met by ONE seam:

  - **Injectable transport.** The client owns a :class:`MessageTransport` — a thin
    ``async create(...) -> message`` Protocol. The real transport
    (:class:`AnthropicTransport`) wraps ``anthropic.AsyncAnthropic``; tests inject a
    deterministic fake and the ``anthropic`` SDK is never imported on that path.
  - **Structured output, fail-closed.** :meth:`AsyncClaudeClient.structured` asks the
    model for JSON matching a caller-supplied ``parse`` validator and returns a typed
    :class:`StructuredResult`. Malformed / non-JSON / refused output yields
    ``ok=False`` — the caller can NEVER build an action from a declined or garbled
    turn (non-custody; agent-service-api.md §0.5/§0.6).
  - **No raw chain-of-thought.** :func:`normalize_message` drops ``thinking`` /
    ``redacted_thinking`` blocks entirely; only ``text`` + ``tool_use`` survive. The
    visible reasoning trace on the SSE surface is a code-authored ``tool_step`` label
    (agent-service-api.md §3.2), never the model's raw CoT.

Config (research.md §6): model ``claude-opus-4-8``, adaptive thinking set EXPLICITLY,
per-agent ``output_config.effort``, refusal checked BEFORE reading content. Credentials
are read from the environment (OAuth token preferred, else API key) and are NEVER
logged — this module emits no logs and keeps the token inside the SDK object
(``repr``-suppressed).
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import re
import time
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import httpx

from .claude import (
    CLAUDE_CODE_SYSTEM_PREFIX,
    MODEL,
    OAUTH_BETA_HEADER,
    AgentRole,
    AuthMode,
    ClaudeError,
    Effort,
    LlmResult,
    ToolCall,
    credential_from_env,
    extract_usage,
    gateway_from_env,
    resolve_effort,
)
from .resilience import (
    GLOBAL_LIMITER,
    Limiter,
    RetryPolicy,
    backoff_delay,
    call_with_resilience,
    is_retryable,
    retry_after_seconds,
)

# Async agents produce small structured/prose outputs, so the async path uses a
# single non-streaming ``create`` (the large-output streaming path stays in the sync
# ``claude`` wrapper). These caps keep a runaway generation bounded.
DEFAULT_STRUCTURED_MAX_TOKENS = 2048
DEFAULT_PROSE_MAX_TOKENS = 4096

# Block types that carry the model's raw reasoning — NEVER surfaced (non-custody:
# tool_step blocks show a SUMMARIZED trace only, agent-service-api.md §3.2).
_THINKING_BLOCK_TYPES = frozenset({"thinking", "redacted_thinking"})


# ─────────────────────────────────────────────────────────────────────────────
# Transport seam — the ONLY thing tests replace to stay off the network.
# ─────────────────────────────────────────────────────────────────────────────


@runtime_checkable
class MessageTransport(Protocol):
    """The single async SDK boundary: shape a request, return an SDK ``Message``.

    Untyped by design at the return (``Any``) — the SDK's message/param TypedDicts are
    version-fluid; this Protocol holds the ``Any`` so the rest of the module stays
    strictly typed. A test double implements this with canned messages and imports no
    network SDK.
    """

    async def create(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        tools: Sequence[Mapping[str, Any]] | None,
        extra_body: Mapping[str, Any],
        user: str | None = None,
    ) -> Any: ...


@dataclass
class AnthropicTransport:
    """The production transport — wraps ``anthropic.AsyncAnthropic`` (imported lazily).

    Constructed via :meth:`for_oauth` / :meth:`for_api_key` so importing this module
    never requires the SDK or a credential (the fake-transport test path stays clean).
    The SDK client is ``repr``-suppressed so a credential can't leak into a log line.
    """

    client: Any = field(repr=False)

    @classmethod
    def for_oauth(cls, oauth_token: str) -> AnthropicTransport:
        """Claude-Code OAuth: Bearer token + the ``oauth-2025-04-20`` beta header.

        ``max_retries=0`` hands 429/529 handling entirely to :mod:`.resilience` — the SDK's
        own silent retry would otherwise double-back-off and hide the events we must log.
        """
        from anthropic import AsyncAnthropic

        return cls(
            client=AsyncAnthropic(
                auth_token=oauth_token,
                default_headers={"anthropic-beta": OAUTH_BETA_HEADER},
                max_retries=0,
            )
        )

    @classmethod
    def for_api_key(cls, api_key: str) -> AnthropicTransport:
        """Plain ``ANTHROPIC_API_KEY`` (Phase-3). ``max_retries=0`` — resilience owns retry."""
        from anthropic import AsyncAnthropic

        return cls(client=AsyncAnthropic(api_key=api_key, max_retries=0))

    async def create(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        tools: Sequence[Mapping[str, Any]] | None,
        extra_body: Mapping[str, Any],
        user: str | None = None,  # noqa: ARG002 — Anthropic messages.create has no `user` field
    ) -> Any:
        from anthropic import NOT_GIVEN

        tools_arg: Any = list(tools) if tools else NOT_GIVEN
        messages_api: Any = self.client.messages
        return await messages_api.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            tools=tools_arg,
            extra_body=dict(extra_body),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Per-request model-alias override (feature 008, US4 — premium model routing). Set at the API
# boundary (the quota dependency) to the caller's tier model_alias; the gateway transport uses it
# in place of its default alias for that request. asyncio task-context isolation keeps it
# per-request (a ``set`` mutates only this request task's context copy — no cross-request leak, no
# reset needed). ``None`` (default) => the transport's configured alias. Advisory routing only,
# never a funds path (N2).
_MODEL_ALIAS: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "sparkpoint_model_alias", default=None
)


def set_model_alias(alias: str | None) -> None:
    """Set the current request's gateway model alias (its tier's ``model_alias``), read by the
    transport. Fail-safe: an empty/unknown value falls back to the transport's default alias."""
    _MODEL_ALIAS.set(alias or None)


def current_model_alias() -> str | None:
    return _MODEL_ALIAS.get()


# OpenAI-compatible gateway transport (LiteLLM → OpenRouter) — the DEFAULT path.
# ─────────────────────────────────────────────────────────────────────────────


class GatewayError(ClaudeError):
    """A non-2xx from the LiteLLM gateway. Carries ``status_code`` so the resilience layer
    retries 429/529 and the API layer maps it to UPSTREAM_UNAVAILABLE. The message NEVER
    contains the URL, headers, or the virtual key — only the status + a coarse cause."""

    def __init__(self, status_code: int, detail: str = "") -> None:
        super().__init__(f"gateway http {status_code}{f': {detail}' if detail else ''}")
        self.status_code = status_code


@dataclass
class _OAIUsage:
    """Duck-typed usage shim so :func:`extract_usage` reads OpenAI token counts unchanged."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


@dataclass
class _OAITextBlock:
    text: str
    type: str = "text"


@dataclass
class _OAIMessage:
    """An Anthropic-``Message``-shaped adapter over an OpenAI chat completion, so the existing
    :func:`normalize_message` (content blocks / stop_reason / usage) works with no branching."""

    content: list[_OAITextBlock]
    stop_reason: str | None
    usage: _OAIUsage
    stop_details: Any = None


@dataclass(frozen=True)
class GatewayStreamPiece:
    """One parsed OpenAI-compatible streaming chunk (transport-level, credential-free)."""

    delta: str | None = None
    finish_reason: str | None = None
    usage: _OAIUsage | None = None


@dataclass(frozen=True)
class StreamChunk:
    """One event from :meth:`AsyncClaudeClient.stream_complete`.

    Exactly one of ``delta`` / ``result`` is set. Deltas are incremental prose the caller may
    forward immediately; the terminal ``result`` carries the SAME full text, the stop reason and
    usage, so the caller can run its post-processing (guardrails, clamps, refusal checks) on the
    complete answer before persisting or rendering it as the authoritative block.
    """

    delta: str | None = None
    result: LlmResult | None = None


def _oai_messages(
    system: list[dict[str, Any]], messages: list[dict[str, Any]]
) -> list[dict[str, str]]:
    """Anthropic system-blocks + messages → OpenAI chat messages (system role + user/assistant)."""
    sys_text = "\n\n".join(str(b.get("text", "")) for b in system if b.get("text"))
    out: list[dict[str, str]] = []
    if sys_text:
        out.append({"role": "system", "content": sys_text})
    for m in messages:
        role = str(m.get("role", "user"))
        content = m.get("content", "")
        if isinstance(content, list):  # Anthropic block list → concatenate text blocks
            content = "".join(
                str(b.get("text", ""))
                for b in content
                if isinstance(b, dict) and b.get("type") == "text"
            )
        out.append({"role": role, "content": str(content)})
    return out


_FINISH_TO_STOP = {"stop": "end_turn", "length": "max_tokens", "content_filter": "refusal"}


@dataclass
class OpenAICompatTransport:
    """Production transport for the LiteLLM gateway (OpenAI ``/chat/completions``).

    Sends the OpenAI chat shape with the virtual key + the stable alias (``sparkpoint-chat``),
    passes the ``user`` field (the server-verified wallet, Phase B) for per-user budgets, and
    adapts the reply back to an Anthropic-``Message`` shape. NO Claude-Code system prefix and NO
    Anthropic ``thinking``/``effort`` params are sent on this path. The virtual key is set only on
    the outgoing Authorization header — never logged or placed in an exception (``GatewayError``).
    """

    base_url: str
    api_key: str = field(repr=False)  # virtual key — secret
    model: str = "sparkpoint-chat"
    timeout: float = 120.0
    client: httpx.AsyncClient | None = field(default=None, repr=False)  # injectable for tests

    def _payload(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        user: str | None,
        stream: bool,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            # Per-request tier override (premium routing) if set, else the configured alias.
            "model": current_model_alias() or self.model,
            "messages": _oai_messages(system, messages),
            "max_tokens": max_tokens,
        }
        if user:
            payload["user"] = user
        if stream:
            payload["stream"] = True
            # Ask the gateway for the terminal usage frame. Without it a streamed turn would
            # report zero tokens (billing/observability drift); connectors that ignore the
            # field simply omit it, and `stream_complete` tolerates a missing usage.
            payload["stream_options"] = {"include_usage": True}
        return payload

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _url(self) -> str:
        return self.base_url.rstrip("/") + "/chat/completions"

    async def create(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        tools: Sequence[Mapping[str, Any]] | None,  # noqa: ARG002 — advisory path sends no tools
        extra_body: Mapping[str, Any],  # noqa: ARG002 — Anthropic thinking/effort dropped here
        user: str | None = None,
    ) -> Any:
        payload = self._payload(
            system=system, messages=messages, max_tokens=max_tokens, user=user, stream=False
        )
        headers = self._headers()
        url = self._url()
        try:
            if self.client is not None:
                resp = await self.client.post(url, json=payload, headers=headers)
            else:
                async with httpx.AsyncClient(timeout=self.timeout) as c:
                    resp = await c.post(url, json=payload, headers=headers)
        except httpx.HTTPError:
            # Network/timeout: treat as a retryable upstream blip (529-class), key never leaked.
            raise GatewayError(529, "network") from None
        if resp.status_code >= 400:
            # Never surface the body verbatim (could echo the request) — status only.
            raise GatewayError(resp.status_code)
        data = resp.json()
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        usage = data.get("usage") or {}
        return _OAIMessage(
            content=[_OAITextBlock(text=str(msg.get("content") or ""))],
            stop_reason=_FINISH_TO_STOP.get(str(choice.get("finish_reason") or ""), "end_turn"),
            usage=_OAIUsage(
                input_tokens=int(usage.get("prompt_tokens") or 0),
                output_tokens=int(usage.get("completion_tokens") or 0),
            ),
        )

    async def stream(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        user: str | None = None,
    ) -> AsyncIterator[GatewayStreamPiece]:
        """Open an SSE ``stream=true`` completion and yield text deltas as they arrive.

        Only the OpenAI-compatible gateway path streams (the Anthropic transport falls back to a
        whole-message ``create`` in :meth:`AsyncClaudeClient.stream_complete`). Errors map to the
        same :class:`GatewayError` shapes as ``create`` so resilience/refund semantics are
        identical; the virtual key never appears in an exception or a log line. A gateway that
        rejects the stream request (e.g. an endpoint without SSE support) raises a non-retryable
        4xx, and the client falls back to the non-streaming path rather than failing the turn.
        """
        payload = self._payload(
            system=system, messages=messages, max_tokens=max_tokens, user=user, stream=True
        )
        headers = self._headers()
        url = self._url()
        client = self.client or httpx.AsyncClient(timeout=self.timeout)
        owns_client = self.client is None
        try:
            async with client.stream("POST", url, json=payload, headers=headers) as resp:
                if resp.status_code >= 400:
                    # Drain so the connection can close; never echo the body (may contain request).
                    await resp.aread()
                    raise GatewayError(resp.status_code)
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue  # blank keep-alives / `event:` lines
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    if not data:
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue  # a malformed keep-alive frame must not kill the stream
                    usage_raw = event.get("usage")
                    usage = (
                        _OAIUsage(
                            input_tokens=int(usage_raw.get("prompt_tokens") or 0),
                            output_tokens=int(usage_raw.get("completion_tokens") or 0),
                        )
                        if isinstance(usage_raw, dict)
                        else None
                    )
                    choice = (event.get("choices") or [{}])[0]
                    delta = (choice.get("delta") or {}).get("content")
                    finish = choice.get("finish_reason")
                    if delta or finish or usage is not None:
                        yield GatewayStreamPiece(
                            delta=str(delta) if delta else None,
                            finish_reason=str(finish) if finish else None,
                            usage=usage,
                        )
        except httpx.HTTPError:
            raise GatewayError(529, "network") from None
        finally:
            if owns_client:
                await client.aclose()


# ─────────────────────────────────────────────────────────────────────────────
# Normalization — refusal-first, CoT-stripped.
# ─────────────────────────────────────────────────────────────────────────────


def normalize_message(msg: Any) -> LlmResult:
    """SDK ``Message`` → :class:`LlmResult`, refusal-checked FIRST and CoT-stripped.

    A ``stop_reason == "refusal"`` returns an EMPTY, refused result BEFORE any content
    is read, so a caller can never fabricate output from a declined turn. ``thinking`` /
    ``redacted_thinking`` blocks are dropped — only ``text`` and ``tool_use`` blocks
    contribute — so no raw chain-of-thought can ever reach the wire.
    """
    stop_reason = getattr(msg, "stop_reason", None)
    if stop_reason == "refusal":
        details = getattr(msg, "stop_details", None)
        category = getattr(details, "category", None) if details is not None else None
        return LlmResult(
            text="",
            stop_reason=stop_reason,
            refused=True,
            refusal_category=category,
            usage=extract_usage(msg),
            raw=msg,
        )

    text_parts: list[str] = []
    tool_calls: list[ToolCall] = []
    for block in getattr(msg, "content", None) or []:
        btype = getattr(block, "type", None)
        if btype in _THINKING_BLOCK_TYPES:
            continue  # raw CoT — never surfaced (non-custody, §3.2)
        if btype == "text":
            text_parts.append(str(getattr(block, "text", "")))
        elif btype == "tool_use":
            tool_calls.append(
                ToolCall(
                    id=str(getattr(block, "id", "")),
                    name=str(getattr(block, "name", "")),
                    input=getattr(block, "input", {}) or {},
                )
            )
    return LlmResult(
        text="".join(text_parts),
        stop_reason=stop_reason,
        tool_calls=tuple(tool_calls),
        usage=extract_usage(msg),
        raw=msg,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Fail-closed JSON extraction for structured output.
# ─────────────────────────────────────────────────────────────────────────────

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL)


def _balanced_span(text: str) -> str | None:
    """Return the first top-level balanced ``{...}`` / ``[...]`` span, string-aware.

    Scans respecting JSON string literals + escapes so a brace inside a string never
    throws off the depth count. ``None`` if no complete top-level structure is found.
    """
    start = -1
    for i, ch in enumerate(text):
        if ch in "{[":
            start = i
            break
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for j in range(start, len(text)):
        ch = text[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth == 0:
                return text[start : j + 1]
    return None


def extract_json(text: str) -> Any | None:
    """Best-effort, fail-closed extraction of a JSON value from model prose.

    Tries, in order: a fenced ```json block, the first balanced object/array span, then
    the whole trimmed string. Returns ``None`` (never raises) when nothing parses — the
    caller then fails closed.
    """
    if not text or not text.strip():
        return None
    candidates: list[str] = []
    fenced = _JSON_FENCE_RE.search(text)
    if fenced is not None:
        candidates.append(fenced.group(1))
    span = _balanced_span(text)
    if span is not None:
        candidates.append(span)
    candidates.append(text.strip())
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


@dataclass(frozen=True)
class StructuredResult[T]:
    """The outcome of a structured-output turn.

    ``ok`` is True ONLY when the model returned JSON that the caller's ``parse``
    validator accepted. ``refused`` marks a model refusal (safe, empty). ``error`` is a
    short, non-sensitive diagnostic for the fail-closed paths (no JSON / parse failed).
    """

    ok: bool
    value: T | None = None
    refused: bool = False
    error: str | None = None
    raw_text: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Client
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class AsyncClaudeClient:
    """A thin async wrapper over an injected :class:`MessageTransport`.

    Construct via :meth:`from_env` / :meth:`for_oauth` / :meth:`for_api_key` in
    production, or ``AsyncClaudeClient(transport=<fake>, auth_mode=...)`` in tests. The
    client shapes cached system blocks + adaptive-thinking/effort ``extra_body`` and
    normalizes the reply; it holds no credential itself (the token lives inside the
    transport's SDK object) and writes no logs.
    """

    transport: MessageTransport = field(repr=False)
    auth_mode: AuthMode
    model: str = MODEL
    # 429/529 resilience knobs. ``limiter=None`` uses the process-global limiter (work
    # order (b)); an injected :class:`Limiter` is for tests only.
    retry_policy: RetryPolicy = field(default_factory=RetryPolicy)
    limiter: Limiter | None = None

    # -- construction ---------------------------------------------------------

    @classmethod
    def for_oauth(cls, oauth_token: str, *, model: str = MODEL) -> AsyncClaudeClient:
        return cls(transport=AnthropicTransport.for_oauth(oauth_token), auth_mode=AuthMode.OAUTH,
                   model=model)

    @classmethod
    def for_api_key(cls, api_key: str, *, model: str = MODEL) -> AsyncClaudeClient:
        return cls(transport=AnthropicTransport.for_api_key(api_key), auth_mode=AuthMode.API_KEY,
                   model=model)

    @classmethod
    def for_gateway(
        cls, base_url: str, api_key: str, *, model: str = "sparkpoint-chat"
    ) -> AsyncClaudeClient:
        """The OpenAI-compatible LiteLLM gateway path (DEFAULT). ``model`` is the gateway alias."""
        return cls(
            transport=OpenAICompatTransport(base_url=base_url, api_key=api_key, model=model),
            auth_mode=AuthMode.GATEWAY,
            model=model,
        )

    @classmethod
    def from_env(cls, *, model: str = MODEL) -> AsyncClaudeClient:
        """Resolve the LLM path, fail-closed. DEFAULT = the LiteLLM gateway when configured
        (``LITELLM_BASE_URL`` + ``LITELLM_API_KEY``); otherwise fall back to the Anthropic path
        in preference order ``NEW_ANTHROPIC_OAUTH_TOKEN`` → ``ANTHROPIC_OAUTH_TOKEN`` →
        ``ANTHROPIC_API_KEY``.

        :raises ClaudeAuthError: when neither the gateway nor an Anthropic credential is set.
        """
        gw = gateway_from_env()
        if gw is not None:
            base_url, api_key, alias = gw
            return cls.for_gateway(base_url, api_key, model=alias)
        mode, value = credential_from_env()
        if mode is AuthMode.OAUTH:
            return cls.for_oauth(value, model=model)
        return cls.for_api_key(value, model=model)

    @property
    def is_oauth(self) -> bool:
        return self.auth_mode is AuthMode.OAUTH

    # -- request shaping ------------------------------------------------------

    def _system_blocks(self, system: str) -> list[dict[str, Any]]:
        """One cached system block. In OAuth mode the Claude-Code prefix is required."""
        text = system
        if self.auth_mode is AuthMode.OAUTH and not text.startswith(CLAUDE_CODE_SYSTEM_PREFIX):
            text = f"{CLAUDE_CODE_SYSTEM_PREFIX}\n\n{text}"
        return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]

    @staticmethod
    def _extra_body(effort: Effort | None, thinking: bool) -> dict[str, Any]:
        """Adaptive thinking + per-agent effort (research.md §6), via ``extra_body``."""
        body: dict[str, Any] = {}
        if thinking:
            body["thinking"] = {"type": "adaptive"}
        if effort is not None:
            body["output_config"] = {"effort": effort}
        return body

    # -- public: one plain turn (read/reason; no tool execution) --------------

    async def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        role: AgentRole | None = None,
        effort: Effort | None = None,
        thinking: bool = True,
        tools: Sequence[Mapping[str, Any]] | None = None,
        max_tokens: int = DEFAULT_PROSE_MAX_TOKENS,
        user: str | None = None,
    ) -> LlmResult:
        """One async Claude turn, refusal-safe and CoT-stripped.

        The advisory agents never execute tools through this client (the state-changing
        path uses the sync manual loop with the policy gate interposed); ``tools`` is
        accepted for read-only tool hints only.

        The single non-streaming ``create`` is wrapped in :func:`call_with_resilience`:
        429/529 are retried (jittered backoff, honoring ``Retry-After``) under the global
        concurrency limiter, then fail closed. Because ``create`` returns a whole ``Message``
        atomically, a retry always happens BEFORE any token/block reaches the SSE surface —
        it can never restart a half-emitted stream (work order (a)).
        """
        eff = resolve_effort(role, effort)
        system_blocks = self._system_blocks(system)
        request_messages = [dict(m) for m in messages]
        extra_body = self._extra_body(eff, thinking)
        msg = await call_with_resilience(
            lambda: self.transport.create(
                model=self.model,
                system=system_blocks,
                messages=request_messages,
                max_tokens=max_tokens,
                tools=tools,
                extra_body=extra_body,
                user=user,
            ),
            policy=self.retry_policy,
            limiter=self.limiter,
        )
        return normalize_message(msg)

    # -- public: one streamed prose turn (text deltas + terminal result) ------

    async def stream_complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        role: AgentRole | None = None,
        effort: Effort | None = None,
        thinking: bool = True,
        tools: Sequence[Mapping[str, Any]] | None = None,
        max_tokens: int = DEFAULT_PROSE_MAX_TOKENS,
        user: str | None = None,
    ) -> AsyncIterator[StreamChunk]:
        """Like :meth:`complete`, but yield text deltas as the model produces them.

        Used ONLY by the final prose responders (Sparky / literacy) so the first sentence can reach
        the user while the rest is still generating. The terminal :class:`StreamChunk` carries the
        SAME full text as a normal :meth:`complete` result, so every caller-side post-processing
        step (``is_unusable`` guard, ``MAX_CHARS`` clamp, refusal check, fallback) runs on the
        COMPLETE text and its final block is authoritative — see ``agents/sparky.stream_reply``.

        Failure semantics are deliberately split, because a half-emitted stream cannot be retried
        without duplicating text:

        * **Before the first delta** — retry 429/529 under the global limiter exactly like
          ``call_with_resilience``; once retries are exhausted (or on a non-retryable error) fall
          back ONCE to the whole-message :meth:`complete`, which keeps a gateway without SSE (or a
          400 from an unknown ``stream_options``) working.
        * **After the first delta** — propagate. The agent then retries its own prose turn (a NEW
          stream id, so the client replaces rather than appends) and, if that fails too, emits an
          honest error block. Nothing partial is ever persisted as an answer (the SSE deltas are
          not ChatBlocks), and no quota is refunded twice (054/056 semantics are unchanged).
        """
        system_blocks = self._system_blocks(system)
        request_messages = [dict(m) for m in messages]
        stream_fn = getattr(self.transport, "stream", None)
        if stream_fn is None:
            result = await self.complete(
                system=system,
                messages=messages,
                role=role,
                effort=effort,
                thinking=thinking,
                tools=tools,
                max_tokens=max_tokens,
                user=user,
            )
            if result.text:
                yield StreamChunk(delta=result.text)
            yield StreamChunk(result=result)
            return

        policy = self.retry_policy
        limiter = self.limiter or GLOBAL_LIMITER
        started = time.monotonic()
        attempt = 0
        while True:
            attempt += 1
            emitted = False
            try:
                async with limiter.slot():
                    parts: list[str] = []
                    stop_reason = "end_turn"
                    usage = _OAIUsage()
                    async for piece in stream_fn(
                        system=system_blocks,
                        messages=request_messages,
                        max_tokens=max_tokens,
                        user=user,
                    ):
                        if piece.usage is not None:
                            usage = piece.usage
                        if piece.finish_reason:
                            stop_reason = _FINISH_TO_STOP.get(piece.finish_reason, "end_turn")
                        if piece.delta:
                            emitted = True
                            parts.append(piece.delta)
                            yield StreamChunk(delta=piece.delta)
                    result = normalize_message(
                        _OAIMessage(
                            content=[_OAITextBlock(text="".join(parts))],
                            stop_reason=stop_reason,
                            usage=usage,
                        )
                    )
                    yield StreamChunk(result=result)
                    return
            except Exception as exc:  # noqa: BLE001 — classify, retry only PRE-delta
                if emitted or not is_retryable(exc):
                    if emitted:
                        raise
                    break
                elapsed = time.monotonic() - started
                if attempt >= policy.max_attempts or elapsed >= policy.total_budget_s:
                    break
                delay = min(
                    backoff_delay(
                        attempt,
                        retry_after=retry_after_seconds(exc),
                        policy=policy,
                    ),
                    max(0.0, policy.total_budget_s - elapsed),
                )
                await asyncio.sleep(delay)

        # Pre-delta failover: one whole-message call. Its own resilience owns retries from here.
        result = await self.complete(
            system=system,
            messages=messages,
            role=role,
            effort=effort,
            thinking=thinking,
            tools=tools,
            max_tokens=max_tokens,
            user=user,
        )
        if result.text:
            yield StreamChunk(delta=result.text)
        yield StreamChunk(result=result)

    # -- public: structured JSON, fail-closed ---------------------------------

    async def structured[T](
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        parse: Callable[[Any], T],
        role: AgentRole | None = None,
        effort: Effort | None = None,
        thinking: bool = True,
        max_tokens: int = DEFAULT_STRUCTURED_MAX_TOKENS,
        user: str | None = None,
    ) -> StructuredResult[T]:
        """Ask the model for JSON and validate it with ``parse`` — fail-closed.

        ``parse`` receives the decoded JSON value and returns the typed result, raising
        on any invalid/missing field. Every failure mode (refusal, no JSON, parse
        error) returns ``ok=False`` so the caller can never act on garbled output. The
        model is instructed to answer with JSON only via the caller's ``system`` prompt.
        """
        result = await self.complete(
            system=system,
            messages=messages,
            role=role,
            effort=effort,
            thinking=thinking,
            max_tokens=max_tokens,
            user=user,
        )
        if result.refused:
            return StructuredResult(ok=False, refused=True, error="model refused", raw_text="")
        payload = extract_json(result.text)
        if payload is None:
            return StructuredResult(
                ok=False, error="no JSON object in model output", raw_text=result.text
            )
        try:
            value = parse(payload)
        except (KeyError, TypeError, ValueError) as exc:
            return StructuredResult(
                ok=False, error=f"schema parse failed: {exc}", raw_text=result.text
            )
        return StructuredResult(ok=True, value=value, raw_text=result.text)
