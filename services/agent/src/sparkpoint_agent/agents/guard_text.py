"""The SHARED prose guards — what a generated answer must never be allowed to contain.

Every prose-answering agent (``sparky``, ``literacy``, and whatever comes next) runs its output
through these before it reaches a user. They are deterministic and pure, because a prompt-level
prohibition is a request a weak model can decline, while a discard is not negotiable.

Two guards, both learned from production incidents:

* :func:`looks_action_shaped` (025/027) — a prose turn must never carry something that looks like
  a machine action/tool-call payload. A ``text``/``tip`` block structurally cannot be signed, so
  this is belt-and-braces over that guarantee.
* :func:`looks_meta_shaped` (028 hotfix, widened here in 029) — the model narrating its own
  prompt or reasoning instead of answering. First seen on the general branch ("We need to answer
  the user: … Use only the reference notes and memory data…"); the 029 regression then caught the
  SAME class on the literacy/tip path ("I don't have information about 'srktoken' **in the
  reference notes provided**"), which is why the guard now lives here rather than in one agent.

Both are HIGH PRECISION on purpose: they match how a model talks *about* a conversation, never how
Sparky talks *in* one (second person, no self-narration). A false positive costs one turn (the
caller falls back honestly); a false negative ships internals to a user.
"""

from __future__ import annotations

import re

#: A machine action/tool-call shape leaking into prose.
_ACTION_SHAPED: tuple[re.Pattern[str], ...] = (
    re.compile(r"proposedaction", re.IGNORECASE),
    re.compile(r"\"type\"\s*:", re.IGNORECASE),
    re.compile(r"\bvault_(?:deposit|withdraw|redeem)\b", re.IGNORECASE),
    re.compile(r"\b(?:aerodrome_swap|aave_(?:supply|withdraw))\b", re.IGNORECASE),
    # calldata / a raw signature — never conversational prose (a 40-hex ADDRESS is allowed).
    re.compile(r"\b0x[0-9a-fA-F]{64,}\b"),
)

#: The model narrating its prompt/plumbing. The first four came from the 028 incident; the rest
#: are the phrasings the 029 browser regression caught slipping past it on the tip path.
_META_SHAPED: tuple[re.Pattern[str], ...] = (
    re.compile(r"\breference notes?\b", re.IGNORECASE),
    re.compile(r"\bmemory data\b", re.IGNORECASE),
    re.compile(r"\bwe (?:need|must|should) (?:to )?(?:answer|not|only|avoid)\b", re.IGNORECASE),
    re.compile(r"\bthe user(?:'s)? (?:asks?|asked|question|message|wants)\b", re.IGNORECASE),
    re.compile(r"\bUSER_MEMORY\b"),
    re.compile(r"\bsystem prompt\b", re.IGNORECASE),
    # 029 additions — observed live:
    re.compile(r"\bthe notes (?:i am|i'm|im) (?:reviewing|given|provided)\b", re.IGNORECASE),
    re.compile(r"\b(?:in|from|per|based on) the (?:provided |given )?notes\b", re.IGNORECASE),
    re.compile(
        r"\b(?:context|passages?|documents?|corpus) (?:provided|supplied|given)\b", re.IGNORECASE
    ),
    re.compile(r"\bmy (?:instructions|context window|training data)\b", re.IGNORECASE),
)


def looks_action_shaped(text: str) -> bool:
    """True iff the prose carries a machine action/tool-call shape (⇒ discard the answer)."""
    return any(pattern.search(text) for pattern in _ACTION_SHAPED)


def looks_meta_shaped(text: str) -> bool:
    """True iff the prose narrates the prompt/reasoning instead of answering (⇒ discard it)."""
    return any(pattern.search(text) for pattern in _META_SHAPED)


def is_unusable(text: str) -> bool:
    """One call for the common case: empty, action-shaped, or meta-shaped ⇒ do not serve it."""
    stripped = text.strip()
    return not stripped or looks_action_shaped(stripped) or looks_meta_shaped(stripped)


#: How many opening characters a streamed prose turn buffers before the first paint (059, restored
#: in 063 after a Defender review). The window must be measured in CHARACTERS of accumulated text,
#: never in chunks: a token-sized first delta ("We") passes the guard on its own, but a response
#: that opens into meta narration ("reference notes", "The user asks") or an action shape
#: (`"type":`, raw calldata) within the first 40 characters must never be painted. Once the window
#: is reached (or the stream ends) the whole buffered prefix is checked, then painted as one delta
#: and every later chunk streams live. The terminal block remains authoritative: a body that only
#: turns unusable AFTER the window may have painted, and is replaced (or retried under a new
#: stream id) exactly as before.
STREAM_HOLD_CHARS = 40


def prefix_is_usable(text: str) -> bool:
    """True when a buffered STREAM PREFIX carries no action/meta shape.

    Same heuristics as :func:`is_unusable`, minus the empty check (the caller only runs this once
    it has buffered data). A prefix can pass and the full answer still fail; the terminal block
    remains authoritative and replaces any paint.
    """
    return not (looks_action_shaped(text) or looks_meta_shaped(text))


__all__ = [
    "STREAM_HOLD_CHARS",
    "is_unusable",
    "looks_action_shaped",
    "looks_meta_shaped",
    "prefix_is_usable",
]
