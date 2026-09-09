"""034 — what Sparky is allowed to read, and why the default is nothing.

PURE. No network. This module answers one question — *may this URL be fetched?* — and it is the
primary safety control on the one input the product does not author.

WHY AN ALLOWLIST AT ALL. A corpus that ingests web content inherits web content's instructions.
Injecting a handful of documents into a retrieval system can make it return attacker-chosen answers
**over 90% of the time**, and no model reliably separates instructions in its prompt from
instructions in retrieved text. For a general assistant that is embarrassing; for an assistant
sitting next to a wallet it is worse.

WHY EMPTY MEANS NOTHING. The most common way an allowlist fails is that somebody writes
``if not allowed: return True`` — "no list configured, so everything is fine". Here an empty list
means **fetch no prose at all**. A misconfiguration, a failed settings read, a fresh install: all of
them fetch nothing. The failure mode is a less-informed document, never an unvetted one.

WHY HOST MATCHING IS EXACT-OR-DOT-SUFFIX. ``docs.aave.com`` must permit ``docs.aave.com`` and
refuse ``evil-docs.aave.com.attacker.io``. A substring check would permit both, which is how
allowlists usually leak.
"""

from __future__ import annotations

from urllib.parse import urlsplit

#: The only scheme permitted. Plain http would let anyone on the path rewrite what Sparky reads.
_SCHEME = "https"

#: Hard ceiling on stored prose. A page cannot be allowed to consume the writer's whole context, and
#: an unbounded quote is also an unbounded injection surface.
MAX_QUOTE_CHARS = 2_000


class NotPermitted(Exception):
    """Raised with a reason a person can act on — refusals are recorded, so they must read well."""


def normalise_domain(raw: str) -> str:
    """A single allowlist entry, as it will be stored: a bare lowercase host.

    Raises ``ValueError`` naming the problem rather than quietly coercing. An admin who typed
    ``https://docs.aave.com/v3`` deserves to know it was not stored the way they wrote it — silently
    accepting it would leave them believing a path restriction is in force when none is.
    """
    entry = (raw or "").strip().lower()
    if not entry:
        raise ValueError("empty entry")
    if "*" in entry:
        raise ValueError(f"{raw!r}: wildcards are not supported — list each host explicitly")
    if "://" in entry:
        raise ValueError(f"{raw!r}: drop the scheme, this is a host list (e.g. docs.aave.com)")
    if "/" in entry:
        raise ValueError(f"{raw!r}: drop the path, this is a host list — the whole host is allowed")
    if ":" in entry:
        raise ValueError(f"{raw!r}: drop the port")
    if " " in entry:
        raise ValueError(f"{raw!r}: hosts cannot contain spaces")
    if "." not in entry:
        raise ValueError(f"{raw!r}: does not look like a host name")
    if entry.startswith(".") or entry.endswith("."):
        raise ValueError(f"{raw!r}: leading or trailing dot")
    return entry


def normalise_domains(raw: object) -> list[str]:
    """A whole list, deduplicated and sorted. Invalid entries raise, naming the offender."""
    if raw is None:
        return []
    if not isinstance(raw, (list, tuple)):
        raise ValueError("the domain list must be a list")
    seen: set[str] = set()
    for item in raw:
        seen.add(normalise_domain(str(item)))
    return sorted(seen)


def host_permitted(host: str, domains: list[str] | tuple[str, ...]) -> bool:
    """Exact host, or a subdomain of an allowed host. Never a substring match."""
    if not domains:
        return False
    candidate = (host or "").strip().lower()
    if not candidate:
        return False
    for allowed in domains:
        if candidate == allowed or candidate.endswith("." + allowed):
            return True
    return False


def check_url(url: str, domains: list[str] | tuple[str, ...]) -> str:
    """Return the permitted URL's host, or raise ``NotPermitted`` with a reason worth recording.

    The reason matters: a refusal is written to the evidence table so an admin can see the
    difference between "we didn't look" and "we were not allowed to look".
    """
    if not domains:
        raise NotPermitted(
            "no prose domains are allowed — the list is empty, so nothing is fetched"
        )
    try:
        parts = urlsplit((url or "").strip())
    except ValueError as exc:
        raise NotPermitted(f"unparseable URL: {exc}") from exc
    if parts.scheme != _SCHEME:
        raise NotPermitted(f"{parts.scheme or 'no scheme'}: only https is fetched")
    host = parts.hostname or ""
    if not host:
        raise NotPermitted("no host in URL")
    if not host_permitted(host, domains):
        raise NotPermitted(f"{host} is not on the allowlist")
    return host


def is_permitted(url: str, domains: list[str] | tuple[str, ...]) -> bool:
    """Boolean form, for callers that do not need the reason."""
    try:
        check_url(url, domains)
    except NotPermitted:
        return False
    return True


def clip_quote(text: str, limit: int = MAX_QUOTE_CHARS) -> str:
    """Fetched prose, bounded. Truncation is marked so a quotation is never silently shortened."""
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip() + " […]"
