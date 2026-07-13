"""llm/ — the Anthropic Claude wrapper. Used by the LLM agents ONLY.

NON-CUSTODY (T126/agent-skill-reviewer): policy/ imports NOTHING from here. The
policy engine is deterministic and LLM-free; the Claude client's most powerful
output is a *proposal* that the deterministic Coordinator + policy layer must
independently validate before anything becomes signable.
"""

from __future__ import annotations

from .claude import (
    AGENT_EFFORT,
    CLAUDE_CODE_SYSTEM_PREFIX,
    MODEL,
    OAUTH_BETA_HEADER,
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
    resolve_effort,
)

__all__ = [
    "AGENT_EFFORT",
    "CLAUDE_CODE_SYSTEM_PREFIX",
    "MODEL",
    "OAUTH_BETA_HEADER",
    "AgentRole",
    "AuthMode",
    "ClaudeAuthError",
    "ClaudeClient",
    "ClaudeError",
    "ClaudeUnsupportedError",
    "Effort",
    "LlmResult",
    "ToolCall",
    "ToolExecution",
    "resolve_effort",
]
