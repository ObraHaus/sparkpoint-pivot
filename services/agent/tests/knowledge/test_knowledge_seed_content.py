# ruff: noqa: S101
"""029/FR-011 — the shipped knowledge corpus must describe the PRODUCT, not just DeFi.

The Aug-3 knowledge quiz asked the assistant six ordinary questions about SparkPoint itself.
The corpus at the time held six documents, all about DeFi mechanics (Aave, ERC-4626, slippage),
and the answers showed it:

  * "Where do I get testnet funds?"        → "Finding testnet liquidity falls outside
                                              SparkPoint's scope" — while the product ships a
                                              faucet and a tip saying exactly where to go.
  * "What shipped this week?"              → "I don't have a changelog."
  * "What is SRK?"                         → no data.
  * "Does Sparky remember things I do
     outside of chat now?"                 → it DENIED the memory feature it actually has.

The last one is the reason these tests exist as CONTENT tests rather than plumbing tests: an
assistant that falsely denies its own shipped capability is worse than one that says nothing,
and no amount of retrieval tuning fixes a corpus that never contained the answer. These assert
the documents exist, load, cover the questions that were missed, and never contradict the
non-custody invariants they describe.
"""

from __future__ import annotations

import re

from sparkpoint_agent.knowledge.ingestion import default_seed_dir, read_corpus

#: The three documents 029 added, and the questions each was written to answer.
NEW_SOURCES = ("sparky-capabilities", "srk-and-premium", "platform-surfaces")


def _corpus() -> dict[str, str]:
    return {source: text for source, text in read_corpus(default_seed_dir())}


def test_the_shipped_corpus_loads_and_contains_the_new_documents() -> None:
    corpus = _corpus()
    for source in NEW_SOURCES:
        assert source in corpus, f"{source} is missing from the shipped seed"
        assert len(corpus[source].strip()) > 500, f"{source} is too thin to answer anything"


def test_the_capability_document_affirms_the_memory_feature_it_actually_has() -> None:
    # The worst observed answer: a false denial of feature 027/028.
    text = _corpus()["sparky-capabilities"].lower()
    assert "across conversations" in text
    assert "never went through the chat" in text, "the fold of off-chat activity is the whole point"
    assert "settings → memory" in text, "say where to read or erase it"


def test_the_capability_document_answers_where_to_get_test_funds() -> None:
    text = _corpus()["sparky-capabilities"].lower()
    assert "faucet" in text
    assert "base sepolia eth" in text, "gas is the blocker, and it does NOT come from SparkPoint"
    assert "coinbase developer platform" in text or "alchemy" in text


def test_the_capability_document_states_the_automation_model_precisely() -> None:
    text = _corpus()["sparky-capabilities"].lower()
    assert "session key" in text
    assert "revoke" in text
    assert "no signature prompt" in text, "'hands off' must be defined, not implied"


def test_srk_document_covers_the_token_the_faucet_and_the_price() -> None:
    text = _corpus()["srk-and-premium"]
    assert "5,000 SRK per 24 hours" in text
    assert "10,000 SRK per month" in text, "the client-set price, not the superseded 500"
    assert "not an investment" in text.lower()


def test_srk_document_states_that_nothing_core_is_gated() -> None:
    text = _corpus()["srk-and-premium"].lower()
    assert "never require srk" in text or "never requires srk" in text
    assert "does not buy better yields" in text


def test_surfaces_document_covers_every_information_page() -> None:
    text = _corpus()["platform-surfaces"].lower()
    for surface in ("trust center", "outcome log", "fees", "learn", "changelog"):
        assert surface in text, surface
    assert "what changed this week" in text, "the changelog question the assistant could not answer"


def test_the_fees_surface_states_the_missing_per_wallet_total_honestly() -> None:
    text = _corpus()["platform-surfaces"].lower()
    assert "no truthful personal total" in text or "per-wallet" in text


# ── the invariants these documents describe must not be contradicted BY them ───

#: Phrasings that would assert custody SparkPoint does not have. Matched across every seed
#: document — a corpus is read back to users verbatim-ish, so a sentence here becomes a claim.
_CUSTODY_CLAIMS = re.compile(
    r"\bwe (?:can |will |may )?(?:move|transfer|withdraw|hold|custody|control) your (?:funds|money)"
    r"|\bsparkpoint (?:holds|controls|custodies) your\b"
    r"|\bon your behalf without\b"
    r"|\bwe sign\b",
    re.IGNORECASE,
)


def test_no_seed_document_claims_custody_of_user_funds() -> None:
    for source, text in _corpus().items():
        match = _CUSTODY_CLAIMS.search(text)
        assert match is None, f"{source} claims custody: {match.group(0)!r}"


def test_no_seed_document_promises_a_return() -> None:
    promised = re.compile(r"\bguaranteed (?:return|yield|apy)\b|\brisk[- ]free\b", re.IGNORECASE)
    for source, text in _corpus().items():
        assert promised.search(text) is None, source


def test_the_new_documents_link_to_each_other_so_retrieval_can_follow_them() -> None:
    corpus = _corpus()
    for source in NEW_SOURCES:
        assert "[[" in corpus[source], f"{source} should reference a sibling document"


# ── 060: the consolidated beta FAQ ────────────────────────────────────────────


def test_the_beta_faq_exists_and_is_substantial() -> None:
    text = _corpus().get("beta-questions", "")
    assert text, "beta-questions.md is missing from the shipped seed"
    assert len(text.strip()) > 1_000, "the FAQ must be deep enough to ground real questions"


def test_the_beta_faq_compares_morpho_and_aave_honestly() -> None:
    text = _corpus()["beta-questions"].lower()
    assert "morpho" in text and "aave" in text
    assert "curator" in text, "the extra Morpho risk is curator risk"
    assert "high-water mark" in text
    assert "neither is automatically safer" in text or "neither venue is insured" in text


def test_the_beta_faq_explains_apy_net_apy_and_variation() -> None:
    text = _corpus()["beta-questions"].lower()
    assert "net apy" in text
    assert "utilization" in text
    assert "spot reading" in text
    assert "as-of" in text or "as of" in text


def test_the_beta_faq_explains_slippage_and_the_swap_fee() -> None:
    text = _corpus()["beta-questions"]
    assert "0.20%" in text
    assert "slippage" in text.lower()
    assert "separate" in text.lower()


def test_the_beta_faq_places_near_intents_in_the_november_build() -> None:
    text = _corpus()["beta-questions"].lower()
    assert "near intents" in text
    assert "november build" in text
    assert "not live" in text


def test_the_beta_faq_states_non_custody_and_signing_precisely() -> None:
    text = _corpus()["beta-questions"].lower()
    assert "holds no private keys" in text
    assert "unsigned" in text
    assert "erc-4626" in text and "withdraw" in text


def test_the_beta_faq_names_the_daily_allowance_and_the_mandate() -> None:
    text = _corpus()["beta-questions"].lower()
    assert "40 chat turns" in text
    assert "400" in text
    assert "mandate" in text
    assert "advisory framing" in text


def test_the_beta_faq_keeps_the_srk_no_price_policy() -> None:
    text = _corpus()["beta-questions"].lower()
    assert "does sparkpoint quote an srk price" in text
    assert "no oracle" in text
