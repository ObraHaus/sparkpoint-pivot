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

import json
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from .claude import (
    CLAUDE_CODE_SYSTEM_PREFIX,
    MODEL,
    OAUTH_BETA_HEADER,
    AgentRole,
    AuthMode,
    Effort,
    LlmResult,
    ToolCall,
    credential_from_env,
    extract_usage,
    resolve_effort,
)
from .resilience import Limiter, RetryPolicy, call_with_resilience

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
    def from_env(cls, *, model: str = MODEL) -> AsyncClaudeClient:
        """Resolve the credential in preference order (work order (0)), fail-closed.

        ``NEW_ANTHROPIC_OAUTH_TOKEN`` → ``ANTHROPIC_OAUTH_TOKEN`` → ``ANTHROPIC_API_KEY``.

        :raises ClaudeAuthError: when none is set (no silent unauthenticated client).
        """
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
            ),
            policy=self.retry_policy,
            limiter=self.limiter,
        )
        return normalize_message(msg)

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
