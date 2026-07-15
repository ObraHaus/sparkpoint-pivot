"""T023 — the Anthropic Claude wrapper (research.md §6).

The single module the LLM agents (portfolio_reader, strategy_recommender,
executor, vault_manager) call Claude through. NEVER imported by policy/.

Config (research.md §6)
-----------------------
- Model ``claude-opus-4-8`` (pinned).
- **Adaptive thinking** ``thinking={"type": "adaptive"}`` — set EXPLICITLY: on
  Opus 4.8 an omitted ``thinking`` field runs WITHOUT thinking.
- **Per-agent effort** via ``output_config.effort`` — recommender ``high``,
  executor/vault ``medium``, portfolio ``low``.
- **Refusal handling** — ``stop_reason == "refusal"`` is checked BEFORE reading
  content; a refusal returns a safe, empty ``LlmResult(refused=True)`` so a
  caller can NEVER fabricate a recommendation from a declined turn.
- **No assistant prefill** (removed on Opus 4.8) — this wrapper never sends a
  trailing assistant turn to steer output; structure requests as context.
- **tool_runner for reads, a manual loop for execution** — ``run_tool_runner``
  drives the SDK's read-path helper; ``run_manual_loop`` interposes a caller
  ``executor`` (the guardrail/policy gate) BETWEEN "model proposed a tool call"
  and "the call executes", so a rejected action yields NO signable artifact.

Auth (both modes)
-----------------
- **Claude-Code OAuth** — ``Authorization: Bearer $ANTHROPIC_OAUTH_TOKEN`` +
  header ``anthropic-beta: oauth-2025-04-20`` + the system prompt MUST begin
  "You are Claude Code, Anthropic's official CLI for Claude." (auto-prepended).
- **Plain API key** (Phase-3) — ``ANTHROPIC_API_KEY``.

Prompt caching (research.md §6): the stable system prompt is sent as a single
cached block (``cache_control: ephemeral``); volatile per-request content
(portfolio, mandate, timestamp) belongs in ``messages``, never interpolated into
the system prompt — so cache hits survive a user's session.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal

from anthropic import NOT_GIVEN, Anthropic

# ─────────────────────────────────────────────────────────────────────────────
# Pinned config (research.md §6)
# ─────────────────────────────────────────────────────────────────────────────

MODEL = "claude-opus-4-8"
CLAUDE_CODE_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude."
OAUTH_BETA_HEADER = "oauth-2025-04-20"

# Credential env vars, in PREFERENCE order (work order (0)): a freshly-rotated Claude-Code
# OAuth token wins over the legacy one, and OAuth wins over a plain API key. Read via
# ``os.getenv`` only; the VALUE is never logged (redacted in every error/repr).
NEW_OAUTH_TOKEN_ENV = "NEW_ANTHROPIC_OAUTH_TOKEN"  # noqa: S105 — env var NAME, not a secret
OAUTH_TOKEN_ENV = "ANTHROPIC_OAUTH_TOKEN"  # noqa: S105 — env var NAME, not a secret
API_KEY_ENV = "ANTHROPIC_API_KEY"

# Stream above this many output tokens to avoid SDK HTTP timeouts (claude-api skill).
DEFAULT_MAX_TOKENS = 16000
STREAM_THRESHOLD = 16000
# Per tool-turn budget in the manual execution loop.
DEFAULT_LOOP_MAX_TOKENS = 8000
DEFAULT_MAX_TURNS = 8

Effort = Literal["low", "medium", "high", "xhigh", "max"]


class AuthMode(StrEnum):
    """Which credential the client authenticates with."""

    OAUTH = "oauth"  # Claude-Code OAuth (Bearer + oauth beta header)
    API_KEY = "api_key"  # plain ANTHROPIC_API_KEY (Phase-3)


class AgentRole(StrEnum):
    """The four LLM agents (research.md §6). The guardrail/policy agent is the
    deterministic, LLM-FREE engine and is intentionally absent — it never calls
    this client."""

    PORTFOLIO_READER = "portfolio_reader"
    STRATEGY_RECOMMENDER = "strategy_recommender"
    EXECUTOR = "executor"
    VAULT_MANAGER = "vault_manager"


# research.md §6 — per-agent effort (recommender is judgment-heavy; the portfolio
# reader is mechanical).
AGENT_EFFORT: dict[AgentRole, Effort] = {
    AgentRole.PORTFOLIO_READER: "low",
    AgentRole.STRATEGY_RECOMMENDER: "high",
    AgentRole.EXECUTOR: "medium",
    AgentRole.VAULT_MANAGER: "medium",
}


def resolve_effort(role: AgentRole | None, override: Effort | None) -> Effort | None:
    """An explicit ``override`` wins; else the agent's default; else ``None`` (server default)."""
    if override is not None:
        return override
    if role is not None:
        return AGENT_EFFORT[role]
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Errors
# ─────────────────────────────────────────────────────────────────────────────


class ClaudeError(RuntimeError):
    """Base class for Claude-wrapper errors."""


class ClaudeAuthError(ClaudeError):
    """No usable credential (neither OAuth token nor API key) was found."""


class ClaudeUnsupportedError(ClaudeError):
    """The installed anthropic SDK lacks a capability this wrapper needs."""


# ─────────────────────────────────────────────────────────────────────────────
# Credential resolution (shared by the sync + async clients)
# ─────────────────────────────────────────────────────────────────────────────


def credential_from_env() -> tuple[AuthMode, str]:
    """Resolve the credential from the environment in PREFERENCE order (work order (0)).

    ``NEW_ANTHROPIC_OAUTH_TOKEN`` (freshly rotated) → ``ANTHROPIC_OAUTH_TOKEN`` (legacy) →
    ``ANTHROPIC_API_KEY``. Returns the auth MODE + the secret value; the value is handed
    straight to the SDK client and is NEVER logged. Fail-closed: no credential raises
    :class:`ClaudeAuthError` rather than building a silent unauthenticated client.
    """
    oauth_token = os.getenv(NEW_OAUTH_TOKEN_ENV) or os.getenv(OAUTH_TOKEN_ENV)
    if oauth_token:
        return AuthMode.OAUTH, oauth_token
    api_key = os.getenv(API_KEY_ENV)
    if api_key:
        return AuthMode.API_KEY, api_key
    raise ClaudeAuthError(
        "no credential: set NEW_ANTHROPIC_OAUTH_TOKEN or ANTHROPIC_OAUTH_TOKEN "
        "(Claude-Code OAuth), or ANTHROPIC_API_KEY"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Result / tool types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ToolCall:
    """A model-proposed tool call surfaced to the caller for gating/execution."""

    id: str
    name: str
    input: Mapping[str, Any]


@dataclass(frozen=True)
class ToolExecution:
    """The caller's response to a ``ToolCall``.

    ``halt=True`` is the non-custody stop signal: the guardrail/policy gate denied
    the proposed action, so the loop returns immediately and emits NO signable
    artifact (the rejected action never becomes a tool result the model can build on).
    """

    content: str
    is_error: bool = False
    halt: bool = False


@dataclass(frozen=True)
class Usage:
    """Token accounting from a Claude response — the prompt-cache observability seam.

    ``cache_read_input_tokens`` is the count served from the cached stable prefix; a WARM
    call should report ``> 0`` (work order (c)). A silent cache invalidation (the stable
    prefix drifting, or ``cache_control`` being dropped) shows up here as this counter
    falling to ``0`` — the integration check asserts on exactly this.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


def extract_usage(msg: Any) -> Usage | None:
    """Read the SDK ``Message.usage`` into a typed :class:`Usage` (``None`` when absent).

    Duck-typed and defensive (the SDK's usage fields are version-fluid and the cache fields
    may be omitted on some responses) — a missing counter reads as ``0``, never an error.
    """
    raw = getattr(msg, "usage", None)
    if raw is None:
        return None

    def _count(name: str) -> int:
        value = getattr(raw, name, 0)
        return value if isinstance(value, int) else 0

    return Usage(
        input_tokens=_count("input_tokens"),
        output_tokens=_count("output_tokens"),
        cache_read_input_tokens=_count("cache_read_input_tokens"),
        cache_creation_input_tokens=_count("cache_creation_input_tokens"),
    )


@dataclass(frozen=True)
class LlmResult:
    """The normalized outcome of a Claude turn / loop.

    ``refused`` — the model declined (``stop_reason == "refusal"``); ``text`` is
    empty and the caller MUST NOT fabricate a recommendation. ``halted`` — a
    manual-loop ``executor`` denied a proposed tool call (non-custody gate). ``usage``
    carries token accounting (incl. ``cache_read_input_tokens``) when the SDK reports it.
    """

    text: str
    stop_reason: str | None
    refused: bool = False
    refusal_category: str | None = None
    halted: bool = False
    tool_calls: tuple[ToolCall, ...] = ()
    usage: Usage | None = None
    raw: Any = None


# ─────────────────────────────────────────────────────────────────────────────
# Client
# ─────────────────────────────────────────────────────────────────────────────

_ToolExecutor = Callable[[ToolCall], ToolExecution]


@dataclass
class ClaudeClient:
    """A thin, opinionated wrapper over the Anthropic SDK for the LLM agents.

    Construct via the classmethods (``from_env`` / ``for_oauth`` / ``for_api_key``)
    or inject a preconfigured SDK client (tests) with ``ClaudeClient(client=...,
    auth_mode=...)``.
    """

    client: Anthropic
    auth_mode: AuthMode
    model: str = MODEL

    # -- construction ---------------------------------------------------------

    @classmethod
    def for_oauth(cls, oauth_token: str, *, model: str = MODEL) -> ClaudeClient:
        """Claude-Code OAuth: Bearer token + the ``oauth-2025-04-20`` beta header."""
        sdk = Anthropic(
            auth_token=oauth_token,
            default_headers={"anthropic-beta": OAUTH_BETA_HEADER},
        )
        return cls(client=sdk, auth_mode=AuthMode.OAUTH, model=model)

    @classmethod
    def for_api_key(cls, api_key: str, *, model: str = MODEL) -> ClaudeClient:
        """Plain ``ANTHROPIC_API_KEY`` (Phase-3)."""
        return cls(client=Anthropic(api_key=api_key), auth_mode=AuthMode.API_KEY, model=model)

    @classmethod
    def from_env(cls, *, model: str = MODEL) -> ClaudeClient:
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
        """Adaptive thinking + per-agent effort, passed through ``extra_body`` so the
        request body carries them verbatim regardless of SDK typing drift."""
        body: dict[str, Any] = {}
        if thinking:
            body["thinking"] = {"type": "adaptive"}
        if effort is not None:
            body["output_config"] = {"effort": effort}
        return body

    def _invoke(
        self,
        *,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        extra_body: dict[str, Any],
        tools: Sequence[Mapping[str, Any]] | None,
        use_stream: bool,
    ) -> Any:
        """Single SDK boundary. Untyped by design — the SDK's TypedDict params are
        version-fluid, so this method holds the ``Any`` and everything else stays typed."""
        messages_api: Any = self.client.messages
        tools_arg: Any = list(tools) if tools else NOT_GIVEN
        if use_stream:
            with messages_api.stream(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
                tools=tools_arg,
                extra_body=extra_body,
            ) as stream:
                return stream.get_final_message()
        return messages_api.create(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            tools=tools_arg,
            extra_body=extra_body,
        )

    @staticmethod
    def _to_result(msg: Any) -> LlmResult:
        """Normalize an SDK ``Message`` → ``LlmResult``, refusal-checked FIRST."""
        stop_reason = getattr(msg, "stop_reason", None)
        if stop_reason == "refusal":
            details = getattr(msg, "stop_details", None)
            category = getattr(details, "category", None) if details is not None else None
            return LlmResult(
                text="",
                stop_reason=stop_reason,
                refused=True,
                refusal_category=category,
                raw=msg,
            )
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in getattr(msg, "content", None) or []:
            btype = getattr(block, "type", None)
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

    # -- public: plain completion (read/reason, no execution) -----------------

    def complete(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        role: AgentRole | None = None,
        effort: Effort | None = None,
        thinking: bool = True,
        tools: Sequence[Mapping[str, Any]] | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        stream: bool | None = None,
    ) -> LlmResult:
        """One Claude turn. Refusal-safe. Streams automatically for large ``max_tokens``.

        This is the read/reason entrypoint — it does not execute tools. For an
        auto tool loop on a read path use ``run_tool_runner``; for the execution
        path with an interposed policy gate use ``run_manual_loop``.
        """
        eff = resolve_effort(role, effort)
        use_stream = stream if stream is not None else max_tokens > STREAM_THRESHOLD
        msg = self._invoke(
            system=self._system_blocks(system),
            messages=[dict(m) for m in messages],
            max_tokens=max_tokens,
            extra_body=self._extra_body(eff, thinking),
            tools=tools,
            use_stream=use_stream,
        )
        return self._to_result(msg)

    # -- public: read-path auto tool loop -------------------------------------

    def run_tool_runner(
        self,
        *,
        system: str,
        tools: Sequence[Any],
        messages: Sequence[Mapping[str, Any]],
        role: AgentRole | None = None,
        effort: Effort | None = None,
        thinking: bool = True,
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ) -> LlmResult:
        """Drive the SDK's read-path tool_runner to completion (research.md §6).

        For READ paths only — the runner executes proposed tools automatically, so
        no policy gate can sit between proposal and execution. Use it for
        portfolio_reader / knowledge_search style tools that never build a tx.
        ``tools`` must be SDK runnable tools (``@beta_tool``-decorated).

        :raises ClaudeUnsupportedError: if the installed SDK lacks the beta helper.
        """
        beta = getattr(self.client, "beta", None)
        beta_messages = getattr(beta, "messages", None) if beta is not None else None
        runner_fn = getattr(beta_messages, "tool_runner", None)
        if runner_fn is None:
            raise ClaudeUnsupportedError("beta.messages.tool_runner unavailable in installed SDK")
        eff = resolve_effort(role, effort)
        runner: Any = runner_fn(
            model=self.model,
            max_tokens=max_tokens,
            system=self._system_blocks(system),
            messages=[dict(m) for m in messages],
            tools=list(tools),
            extra_body=self._extra_body(eff, thinking),
        )
        final = runner.until_done()
        return self._to_result(final)

    # -- public: execution-path manual loop (policy gate interposed) ----------

    def run_manual_loop(
        self,
        *,
        system: str,
        messages: Sequence[Mapping[str, Any]],
        tools: Sequence[Mapping[str, Any]],
        executor: _ToolExecutor,
        role: AgentRole | None = None,
        effort: Effort | None = None,
        thinking: bool = True,
        max_tokens: int = DEFAULT_LOOP_MAX_TOKENS,
        max_turns: int = DEFAULT_MAX_TURNS,
    ) -> LlmResult:
        """The execution-path agentic loop with the guardrail interposed (research.md §6).

        Each turn: the model proposes tool calls; the caller's ``executor`` decides
        each one — this is where the deterministic policy gate runs. If any
        execution returns ``halt=True`` (policy rejected), the loop stops and
        returns ``halted=True`` with NO further model turn — a rejected action
        never becomes a signable artifact (non-custody, §6). A refusal short-circuits
        the same way (no fabricated result).
        """
        eff = resolve_effort(role, effort)
        sys_blocks = self._system_blocks(system)
        extra = self._extra_body(eff, thinking)
        convo: list[dict[str, Any]] = [dict(m) for m in messages]

        for _ in range(max_turns):
            msg = self._invoke(
                system=sys_blocks,
                messages=convo,
                max_tokens=max_tokens,
                extra_body=extra,
                tools=tools,
                use_stream=False,
            )
            result = self._to_result(msg)
            if result.refused:
                return result
            if result.stop_reason != "tool_use":
                return result  # end_turn / stop_sequence — a final, non-tool answer

            # Record the assistant turn (with its tool_use blocks) verbatim.
            convo.append({"role": "assistant", "content": getattr(msg, "content", [])})

            tool_results: list[dict[str, Any]] = []
            halted = False
            for call in result.tool_calls:
                execution = executor(call)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "content": execution.content,
                        "is_error": execution.is_error,
                    }
                )
                if execution.halt:
                    halted = True
            convo.append({"role": "user", "content": tool_results})

            if halted:
                # Non-custody stop: policy gate denied — emit no signable artifact.
                return LlmResult(
                    text=result.text,
                    stop_reason="halted",
                    halted=True,
                    tool_calls=result.tool_calls,
                    raw=msg,
                )

        return LlmResult(text="", stop_reason="max_turns", raw=None)
