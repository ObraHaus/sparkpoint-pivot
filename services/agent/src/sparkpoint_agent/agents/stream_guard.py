"""073 — the INCREMENTAL prose guard that decides what a streamed answer may paint.

``guard_text`` answers a WHOLE-answer question: is this finished text safe to serve? Streaming
needs the same question answered for a *prefix* while the answer is still being generated, and
the old 059/063 answer — hold the first 40 characters, then paint everything unchecked — is what
caused the 2026-10-30 beta incident: ``"Morpho vs Aave"`` painted ~500 characters of model text,
then the terminal ``guard_meta`` rejected the complete answer and the code fallback replaced it.
The user saw text the guard had already rejected.

This module is the fix: a pure, deterministic, incremental guard. It buffers model deltas and
releases only COMPLETE SEGMENTS, and it checks every release against the CUMULATIVE text using
the exact same :func:`~sparkpoint_agent.agents.guard_text.looks_action_shaped` /
:func:`~sparkpoint_agent.agents.guard_text.looks_meta_shaped` predicates the terminal block uses.
A guarded phrase therefore cannot be painted before the guard sees it:

* a sentence terminator (``. ! ?`` followed by whitespace/end, excluding decimals and the common
  ``e.g.`` / ``i.e.`` / ``vs.`` abbreviations) or a newline ends a segment;
* when no boundary appears within :data:`SEGMENT_CAP_CHARS`, release up to the last whitespace but
  keep :data:`LOOKBEHIND_CHARS` of trailing text unreleased, so a multi-word guard phrase can
  never be split across released and unreleased text (the tail is at least the longest guard
  phrase);
* before a release, the cumulative released text plus the candidate is checked; on a hit the guard
  trips, releases nothing more, and the caller aborts the model stream;
* the forwarded total is aligned to the caller's clamp (:meth:`StreamGuard.finish`), so a served
  answer never replaces a longer paint with a shorter block.

The guard is transport-only. It never owns the terminal reply, never persists anything, and its
``released_text`` is only used to decide what the client has already seen.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .guard_text import looks_action_shaped, looks_meta_shaped

#: A segment with no sentence/newline boundary is force-released after this many characters.
#: A long first sentence is the latency cost of never painting unguarded prose; 280 characters is
#: roughly two or three model tokens' worth of a sentence and bounds the wait to a constant.
SEGMENT_CAP_CHARS = 280

#: Trailing characters kept unreleased when a segment is force-released at the cap. It must be at
#: least the longest guard phrase so a multi-word phrase cannot straddle the release boundary.
#: The longest current pattern is well under 40 characters; 64 leaves headroom for a future one.
LOOKBEHIND_CHARS = 64

#: A sentence terminator that must not end a segment because it belongs to a number or a common
#: abbreviation. Lower-cased token (including the period) compared against the text before the dot.
_ABBREVIATIONS = frozenset(
    {"e.g.", "i.e.", "vs.", "etc.", "mr.", "mrs.", "ms.", "dr.", "prof.", "st.", "no.", "fig."}
)

_TERMINATORS = ".!?"

#: 073 — comparative answers are accepted by WHOLE-answer checks that cannot be known mid-stream
#: (065/066/067: every subject named, not a whole-answer refusal/decline), and the 2026-10-30
#: incident was exactly a comparative turn. Holding the complete answer until those checks pass is
#: the only way to guarantee no rejected comparison is ever painted. This is a POLICY constant, not
#: an env flag: it is the documented behaviour of every deployment, not a tunable.
HOLD_COMPARATIVE_PROSE = True


def _token_before(text: str, index: int) -> str:
    """The whitespace-delimited token ending at ``index`` (inclusive), lower-cased."""
    start = index
    while start > 0 and not text[start - 1].isspace():
        start -= 1
    return text[start : index + 1].lower()


def _is_sentence_boundary(text: str, index: int) -> bool:
    """True when ``text[index]`` ends a sentence (not a decimal or a common abbreviation)."""
    if text[index] not in _TERMINATORS:
        return False
    # A terminator must be followed by whitespace or end-of-buffer. This alone excludes "4.45"
    # and any in-word dot; the abbreviation check below excludes "e.g. " / "vs. ".
    if index + 1 < len(text) and not text[index + 1].isspace():
        return False
    return not (text[index] == "." and _token_before(text, index) in _ABBREVIATIONS)


def _first_boundary(buffer: str) -> int | None:
    """End index (exclusive) of the earliest complete segment within :data:`SEGMENT_CAP_CHARS`."""
    limit = min(len(buffer), SEGMENT_CAP_CHARS)
    for index in range(limit):
        if buffer[index] == "\n":
            return index + 1
        if _is_sentence_boundary(buffer, index):
            return index + 1
    return None


def _forced_boundary(buffer: str, lookbehind: int) -> int | None:
    """A cap-forced release point, leaving ``lookbehind`` (and whole words) unreleased."""
    limit = min(len(buffer), SEGMENT_CAP_CHARS)
    cut = buffer.rfind(" ", 0, limit)
    if cut <= 0:
        cut = buffer.rfind("\n", 0, limit)
    if cut <= 0:
        cut = limit
    # Never release inside the lookbehind tail.
    cut = min(cut, len(buffer) - lookbehind)
    if cut <= 0:
        return None
    # Prefer a whitespace boundary so the paint never ends mid-word.
    space = buffer.rfind(" ", 0, cut)
    if space > 0:
        cut = space
    return cut if cut > 0 else None


def _ends_with_clamp_terminator(text: str, end: int) -> bool:
    """True when ``text[:end]`` ends with a clamp terminator (trailing whitespace ignored)."""
    index = end - 1
    while index >= 0 and text[index].isspace():
        index -= 1
    return index >= 0 and text[index] in _TERMINATORS


def _last_clamp_terminator(text: str, end: int) -> int:
    """Index of the last ``.``/``!``/``?`` in ``text[:end]``, matching ``Sparky._clamp``."""
    return max(text.rfind(".", 0, end), text.rfind("!", 0, end), text.rfind("?", 0, end))


def _clamp_length(text: str, max_chars: int) -> int:
    """Length of ``text`` after the caller's clamp (``Sparky._clamp``) — a pure prefix length.

    Kept in lock-step with ``Sparky._clamp``: over budget, cut after the last sentence
    terminator in the window, else at the last space, else hard at the budget. When the text is
    under budget the clamp returns it whole (the caller strips leading/trailing whitespace).
    """
    if len(text) <= max_chars:
        return len(text)
    window = text[:max_chars]
    cut = _last_clamp_terminator(window, len(window))
    if cut > 0:
        return cut + 1
    space = window.rfind(" ")
    return space if space > 0 else max_chars


@dataclass
class StreamGuard:
    """Incremental, pure release gate shared by ``Sparky.stream_reply`` and ``Literacy.stream_tip``.

    Usage::

        guard = StreamGuard(max_chars=700)
        for delta in model_deltas:
            for piece in guard.feed(delta):
                yield piece
            if guard.tripped:
                break                 # abort the model stream; the answer would be discarded
        piece = guard.finish(final_body)  # release the last safe tail, aligned to the clamp

    ``tripped`` is sticky. ``reason`` is the terminal guard reason (``"action"``/``"meta"``) and is
    what the caller reports as ``SparkyReply.failure``, preserving the 065/066/067 fallback/retry
    semantics. ``released_text`` is exactly what the client has been allowed to paint.
    """

    #: The caller's user-visible budget (``Sparky.MAX_CHARS``); ``None`` means no clamp (tips).
    max_chars: int | None = None
    segment_cap: int = SEGMENT_CAP_CHARS
    lookbehind: int = LOOKBEHIND_CHARS
    _released: list[str] = field(default_factory=list, init=False, repr=False)
    _buffer: str = field(default="", init=False, repr=False)
    _tripped: bool = field(default=False, init=False, repr=False)
    _reason: str | None = field(default=None, init=False, repr=False)

    @property
    def tripped(self) -> bool:
        """True once a guard predicate matched any text seen so far (sticky)."""
        return self._tripped

    @property
    def reason(self) -> str | None:
        """``"action"`` / ``"meta"`` when tripped, else ``None``."""
        return self._reason

    @property
    def painted(self) -> bool:
        """True when at least one non-empty segment has been released."""
        return bool(self._released)

    @property
    def released_text(self) -> str:
        """Everything released so far — exactly the concatenation the client has painted."""
        return "".join(self._released)

    @property
    def pending_text(self) -> str:
        """Text held back for a future segment (includes the forced-release lookbehind tail)."""
        return self._buffer

    def feed(self, delta: str) -> list[str]:
        """Feed one model delta; return the safe segments (if any) that may now be painted.

        Checks the CUMULATIVE text first, so a phrase completed by this delta trips even when its
        beginning was buffered by an earlier feed. On a trip nothing from this delta is released.
        """
        if self._tripped or not delta:
            return []
        # The terminal body is ``result.text.strip()``; do not paint leading whitespace the final
        # block will not contain (it would make the paint a non-prefix and force a retract).
        if not self._released:
            self._buffer = (self._buffer + delta).lstrip()
        else:
            self._buffer += delta
        known = self.released_text + self._buffer
        # Same precedence as ``guard_text.unusable_reason``: action before meta.
        if looks_action_shaped(known):
            self._trip("action")
            return []
        if looks_meta_shaped(known):
            self._trip("meta")
            return []
        pieces: list[str] = []
        while True:
            end = self._next_end()
            if end is None:
                break
            piece = self._buffer[:end]
            self._buffer = self._buffer[end:]
            self._released.append(piece)
            pieces.append(piece)
        return pieces

    def finish(self, final_text: str | None = None) -> str:
        """Release the last safe tail at end-of-stream, aligned to the authoritative answer.

        ``final_text`` is the caller's post-processed body (already stripped, clamped for Sparky).
        Only the part of the buffered text that is still a prefix of it is released, so the final
        block never shrinks below the paint. When the caller's final text does not extend the
        paint (a clamp cut earlier, or a degraded answer), nothing more is released; the caller
        may emit a retract before the terminal block.
        """
        if self._tripped:
            return ""
        if final_text is None:
            want = len(self._buffer)
        else:
            if not final_text.startswith(self.released_text):
                return ""
            want = max(0, len(final_text) - len(self.released_text))
        piece = self._buffer[:want]
        if not piece:
            return ""
        self._buffer = self._buffer[len(piece) :]
        self._released.append(piece)
        return piece

    def _trip(self, reason: str) -> None:
        self._tripped = True
        self._reason = reason

    def _next_end(self) -> int | None:
        """The next release length from ``_buffer``, or ``None`` when more text is needed."""
        buffer = self._buffer
        if not buffer:
            return None
        end = _first_boundary(buffer)
        if end is None:
            if len(buffer) < self.segment_cap:
                return None
            end = _forced_boundary(buffer, self.lookbehind)
            if end is None:
                return None
        known = self.released_text + buffer
        absolute_end = len(self.released_text) + end
        # Align to the caller's clamp: never paint text that a later clamp could cut away. If the
        # candidate does not end at a terminator, stop at the last terminator already in the
        # cumulative text (if any); otherwise release as-is (a no-terminator answer is cut by the
        # clamp's whole-word fallback near the budget, which is always beyond this paint).
        if not _ends_with_clamp_terminator(known, absolute_end):
            cut = _last_clamp_terminator(known, absolute_end)
            if cut >= 0:
                absolute_end = cut + 1
        if self.max_chars is not None:
            safe_total = _clamp_length(known, self.max_chars)
            absolute_end = min(absolute_end, safe_total)
        end = absolute_end - len(self.released_text)
        if end <= 0:
            return None
        return min(end, len(buffer))

    # Keep the module's public constants discoverable on an instance for tests/consumers.
    @property
    def cap_chars(self) -> int:
        return self.segment_cap

    @property
    def tail_chars(self) -> int:
        return self.lookbehind


__all__ = [
    "HOLD_COMPARATIVE_PROSE",
    "LOOKBEHIND_CHARS",
    "SEGMENT_CAP_CHARS",
    "StreamGuard",
]
