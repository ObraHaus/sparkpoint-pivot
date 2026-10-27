"""llm/ — the Anthropic Claude wrapper. Used by the LLM agents ONLY.

NON-CUSTODY (T126/agent-skill-reviewer): policy/ imports NOTHING from here. The
policy engine is deterministic and LLM-free; the Claude client's most powerful
output is a *proposal* that the deterministic Coordinator + policy layer must
independently validate before anything becomes signable.
"""

from __future__ import annotations

from .claude import (
    AGENT_EFFORT,
    API_KEY_ENV,
    CLAUDE_CODE_SYSTEM_PREFIX,
    MODEL,
    NEW_OAUTH_TOKEN_ENV,
    OAUTH_BETA_HEADER,
    OAUTH_TOKEN_ENV,
    AgentRole,
    AuthMode,
    ClaudeAuthError,
    ClaudeClient,
    ClaudeError,
    ClaudeUnsupportedError,
    Effort,
    LlmResult,
    ToolCall,
    ToolExecution,
    Usage,
    credential_from_env,
    extract_usage,
    resolve_effort,
)
from .client import (
    AnthropicTransport,
    AsyncClaudeClient,
    MessageTransport,
    StreamChunk,
    StructuredResult,
    extract_json,
    normalize_message,
)
from .resilience import (
    GLOBAL_LIMITER,
    RETRYABLE_STATUS,
    Limiter,
    LlmBusyError,
    RetryPolicy,
    backoff_delay,
    call_with_resilience,
    is_retryable,
    retry_after_seconds,
    status_code,
)

__all__ = [
    "AGENT_EFFORT",
    "API_KEY_ENV",
    "CLAUDE_CODE_SYSTEM_PREFIX",
    "GLOBAL_LIMITER",
    "MODEL",
    "NEW_OAUTH_TOKEN_ENV",
    "OAUTH_BETA_HEADER",
    "OAUTH_TOKEN_ENV",
    "RETRYABLE_STATUS",
    "AgentRole",
    "AnthropicTransport",
    "AsyncClaudeClient",
    "AuthMode",
    "ClaudeAuthError",
    "ClaudeClient",
    "ClaudeError",
    "ClaudeUnsupportedError",
    "Effort",
    "Limiter",
    "LlmBusyError",
    "LlmResult",
    "MessageTransport",
    "RetryPolicy",
    "StreamChunk",
    "StructuredResult",
    "ToolCall",
    "ToolExecution",
    "Usage",
    "backoff_delay",
    "call_with_resilience",
    "credential_from_env",
    "extract_json",
    "extract_usage",
    "is_retryable",
    "normalize_message",
    "resolve_effort",
    "retry_after_seconds",
    "status_code",
]
