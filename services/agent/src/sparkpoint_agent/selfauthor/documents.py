"""034 — the six living documents, and why there are exactly six.

PURE. Definitions and rendering; no I/O.

SIX IS A CEILING, NOT A TARGET, AND IT IS ENFORCED IN CODE. The obvious version of this feature —
one note per day — would make the assistant worse at answering, because retrieval quality falls as a
corpus grows and the failure is silent. A generated slug would create a seventh document, then a
hundredth, and nobody would notice until a question that used to work stopped working. So the slugs
are constants, the list is closed, and a document with nothing to say is RETIRED rather than padded.

WHAT A DOCUMENT IS. A rendering of the evidence a run fetched, in prose, with every figure naming
the chain it came from. Rewritten in place: `ingest_note(source=slug)` derives chunk ids from
(source, index) and prunes orphans, so a rewrite replaces exactly this document's chunks.
"""

from __future__ import annotations

from dataclasses import dataclass

from .claims import Claim
from .evidence import TESTNET_CHAIN_IDS, Evidence

STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"
STATUS_RETIRED = "retired"


@dataclass(frozen=True)
class DocumentSpec:
    """One of the six. ``needs`` names the evidence labels without which it has nothing to say."""

    slug: str
    title: str
    purpose: str
    needs: tuple[str, ...]


#: The six. Adding a seventh is a decision, not a code change someone makes in passing.
DOCUMENTS: tuple[DocumentSpec, ...] = (
    DocumentSpec(
        slug="self-authored-base-usdc-yields",
        title="USDC yields on Base",
        purpose=(
            "What USDC earns on Base right now — in the live market, and on the testnet this alpha "
            "runs on — so a reader can tell the two apart."
        ),
        needs=("aave_supply_apy_bps_mainnet", "vault_net_apy_bps_testnet"),
    ),
    DocumentSpec(
        slug="self-authored-vault-fee-comparison",
        title="How our vault compares on fees",
        purpose=(
            "What our performance fee actually costs against the alternatives, stated as money "
            "rather than as a percentage of a percentage."
        ),
        needs=("vault_performance_fee_bps", "aave_supply_apy_bps_mainnet"),
    ),
    DocumentSpec(
        slug="self-authored-testnet-vs-mainnet",
        title="Why the alpha's rate looks low",
        purpose=(
            "The most confusing thing a tester meets: the alpha shows a fraction of what the "
            "same strategy pays in the live market, and neither number is wrong."
        ),
        needs=("vault_net_apy_bps_testnet", "aave_supply_apy_bps_mainnet"),
    ),
    DocumentSpec(
        slug="self-authored-answer-gaps",
        title="Questions we answer badly",
        purpose=(
            "Which real questions retrieved nothing useful, so the next round of documentation is "
            "aimed at what people actually ask."
        ),
        needs=("answer_gap_topics",),
    ),
    DocumentSpec(
        slug="self-authored-protocol-watch",
        title="What changed in the protocols we use",
        purpose="Movements in Aave and Morpho that affect what this product can offer.",
        needs=("aave_supply_apy_bps_mainnet",),
    ),
    DocumentSpec(
        slug="self-authored-product-surface",
        title="What SparkPoint does today",
        purpose="Our own product, consolidated: what shipped, what it claims, what it explains.",
        needs=("product_surface_summary",),
    ),
)

DOCUMENT_SLUGS: frozenset[str] = frozenset(d.slug for d in DOCUMENTS)

#: The ceiling, as a number the code can assert against.
MAX_DOCUMENTS = len(DOCUMENTS)


def spec_for(slug: str) -> DocumentSpec | None:
    for doc in DOCUMENTS:
        if doc.slug == slug:
            return doc
    return None


def has_what_it_needs(spec: DocumentSpec, evidence: list[Evidence]) -> bool:
    """Whether this run fetched enough for this document to say anything true.

    Nothing fetched means nothing written (FR-005). A document that cannot meet its own `needs` is
    left exactly as it was rather than rewritten thinner — a half-empty rewrite would replace a
    good document with a worse one, which is the opposite of the point.
    """
    have = {e.label for e in evidence if e.publishable}
    return all(label in have for label in spec.needs)


def _figures_section(items: list[Evidence]) -> list[str]:
    """Figures, grouped by world.

    A document may NEVER put a testnet figure beside a mainnet one as if they were competing
    options — the alpha reads 0.44% while the identical strategy pays 3.48% in the live market, and
    presenting those as a choice is the single most misleading thing this feature could produce. So
    they render in separate, labelled passages, and each figure names its chain in its own line.
    """
    figures = [e for e in items if e.is_figure and e.publishable]
    if not figures:
        return []

    live = [e for e in figures if e.chain_id not in TESTNET_CHAIN_IDS]
    test = [e for e in figures if e.chain_id in TESTNET_CHAIN_IDS]

    lines: list[str] = []
    if live:
        lines.append("**In the live market**")
        lines.append("")
        lines += [f"- {e.describe()}" for e in live]
        lines.append("")
    if test:
        lines.append("**On the testnet this alpha runs on**")
        lines.append("")
        lines += [f"- {e.describe()}" for e in test]
        lines.append("")
        lines.append(
            "Testnet rates come from a handful of test wallets rather than a real lending market. "
            "They demonstrate that the mechanism works; they are not a forecast, and they are not "
            "comparable with the live figures above."
        )
        lines.append("")
    return lines


def _quotes_section(items: list[Evidence]) -> list[str]:
    """Fetched prose, always attributed, always as a quotation.

    Never merged into our own voice. A quotation whose speaker is unknown is indistinguishable from
    something we wrote and checked, and this text came from a third party.
    """
    quotes = [e for e in items if e.is_prose and e.publishable]
    if not quotes:
        return []
    lines = ["**What the sources say**", ""]
    for e in quotes:
        lines.append(f"> {(e.quote or '').strip()}")
        lines.append(">")
        lines.append(f"> — {e.attribution}{f' ({e.url})' if e.url else ''}")
        lines.append("")
    return lines


def render_document(
    spec: DocumentSpec,
    *,
    evidence: list[Evidence],
    claims: list[Claim],
    body: str = "",
) -> str:
    """One document as markdown, ready to embed.

    Deliberately says what it is in its own first lines. A retrieved chunk must never be mistakable
    for documentation a person wrote and checked — the citation label says so too, but a reader who
    sees the text without the citation should still be able to tell.
    """
    lines = [
        f"# {spec.title}",
        "",
        (
            "Source: a SparkPoint research note written by Sparky, our assistant, and not yet "
            "reviewed by a person. Every figure below states the chain it came from."
        ),
        "",
        spec.purpose,
        "",
    ]

    if body.strip():
        lines += [body.strip(), ""]

    lines += _figures_section(evidence)

    if claims:
        lines += ["**What this means**", ""]
        lines += [f"- {c.text}" for c in claims]
        lines.append("")

    lines += _quotes_section(evidence)

    return "\n".join(lines).strip() + "\n"


def is_publishable_now(
    *,
    status: str,
    publish_mode: str,
    first_written_at_epoch: float,
    draft_window_hours: int,
    now_epoch: float,
) -> bool:
    """Whether a document may become retrievable.

    In manual mode, never automatically — an admin publishes. In automatic mode, only once the draft
    window has elapsed **measured from when the document was FIRST written**, not from its last
    rewrite. If the clock restarted on every rewrite, a document rewritten daily would never leave
    draft: unreachable by construction, and it would take weeks to notice.
    """
    if status == STATUS_RETIRED:
        return False
    if publish_mode != "automatic":
        return False
    elapsed_hours = (now_epoch - first_written_at_epoch) / 3600.0
    return elapsed_hours >= draft_window_hours
