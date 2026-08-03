# ruff: noqa: S101
"""034 — three defects the FIRST LIVE RUN found, each pinned so it cannot come back.

Every one of these passed the full suite and the production build. They were only visible once a
real run published real documents against real data, which is the argument for verifying live
rather than declaring done at green.
"""

from __future__ import annotations

import ast
import inspect
from decimal import Decimal

import pytest

from sparkpoint_agent.api import self_authoring_runner
from sparkpoint_agent.selfauthor import sources
from sparkpoint_agent.selfauthor.documents import DOCUMENTS
from sparkpoint_agent.selfauthor.evidence import Evidence, label_name


def _code_only(module: object) -> str:
    """A module's executable source, with docstrings and comments removed.

    A source scan that includes prose will match the comment explaining the rule it is testing —
    which passes, reads correctly, and checks nothing.
    """
    tree = ast.parse(inspect.getsource(module))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                if isinstance(body[0].value.value, str):
                    node.body = body[1:] or [ast.Pass()]
    return ast.unparse(tree)


def test_the_guard_that_strips_prose_actually_strips_it() -> None:
    """A helper this load-bearing must be shown to work, or the tests above are decoration."""
    stripped = _code_only(self_authoring_runner)
    assert "reintroduce exactly the coupling" not in stripped, "docstrings are gone"
    assert "pg_try_advisory_lock" in stripped, "real code survives"


def test_a_published_figure_never_shows_a_database_column_name() -> None:
    """The first live run published:

        "aave_supply_apy_bps_mainnet on Base mainnet: 3.48%"

    A column name, in a document written for users. Correct, and unreadable."""
    item = Evidence(
        source="defillama", label="aave_supply_apy_bps_mainnet", value=Decimal("348"), chain_id=8453
    )
    described = item.describe()
    assert "aave_supply_apy_bps_mainnet" not in described
    assert "Aave's USDC supply rate" in described
    assert "Base mainnet" in described, "the chain is still named — that rule is unchanged"


def test_an_unnamed_label_reads_badly_rather_than_breaking() -> None:
    """A new label with no entry should be ugly, not fatal — the fix is then one line."""
    assert label_name("some_new_label") == "some new label"
    assert "_" not in label_name("some_new_label")


def test_every_document_can_actually_be_written() -> None:
    """The first live run wrote FIVE of six. `self-authored-vault-fee-comparison` needs
    `vault_performance_fee_bps` and nothing produced it, so a document the client specifically
    asked for could never exist. A defined document with no source is worse than no document: it
    looks like a feature that quietly failed."""
    produced = set()
    for name in ("fetch_chain", "fetch_defillama", "fetch_own_corpus", "fetch_answer_gaps"):
        produced |= {
            line.split('label="')[1].split('"')[0]
            for line in inspect.getsource(getattr(sources, name)).split("\n")
            if 'label="' in line
        }

    orphans = [
        f"{doc.slug} needs {label}"
        for doc in DOCUMENTS
        for label in doc.needs
        if label not in produced
    ]
    assert not orphans, (
        "these documents can never be written, because nothing produces the evidence they "
        "require:\n  " + "\n  ".join(orphans)
    )


def test_a_declined_run_is_RECORDED_not_merely_returned() -> None:
    """FR-002. The decline was real — the lock held — but invisible: an admin who pressed the
    button twice saw one run and no explanation for the other. "It silently did nothing" and "it
    declined because one was already running" look identical from the console, and only one of
    those is fine."""
    source = inspect.getsource(self_authoring_runner.run_once)
    lock_check = source.index("if not got:")
    tail = source[lock_check:]
    assert "open_run" in tail, "a declined run must open a row"
    assert "close_run" in tail, "and close it with the outcome"
    assert "OUTCOME_LOCKED" in tail


def test_our_own_fee_is_not_presented_as_a_testnet_market_rate() -> None:
    """The second live run rendered the performance fee under "On the testnet this alpha runs on",
    beneath the disclaimer that those figures "come from a handful of test wallets" and "are not a
    forecast".

    Both statements are true of a market rate and false of a fee. Read together, they implied our
    10% fee is a testnet artifact that will be different on mainnet. It will not be — and a reader
    making a decision on that would have been misled by us, in exactly the dimension this feature
    exists to protect.
    """
    from sparkpoint_agent.selfauthor.documents import render_document, spec_for

    spec = spec_for("self-authored-vault-fee-comparison")
    assert spec is not None
    fee = Evidence(
        source="chain", label="vault_performance_fee_bps", value=Decimal("1000"), chain_id=84532
    )
    rate = Evidence(
        source="defillama", label="aave_supply_apy_bps_mainnet", value=Decimal("348"), chain_id=8453
    )
    text = render_document(spec, evidence=[fee, rate], claims=[])

    assert "Our own terms" in text
    assert "do not change between the testnet and the live market" in text
    # The fee must appear ABOVE the testnet caveat, not inside it.
    # No testnet MARKET rate in this document, so no testnet block at all.
    assert "On the testnet this alpha runs on" not in text
    assert text.index("performance fee") < text.index("Aave's USDC supply rate")


def test_a_fee_carries_no_chain_clause() -> None:
    """A fee is our term, not something a market on some chain decided."""
    fee = Evidence(
        source="chain", label="vault_performance_fee_bps", value=Decimal("1000"), chain_id=84532
    )
    assert "Base Sepolia" not in fee.describe()
    assert "10.00%" in fee.describe()


def test_a_market_rate_still_names_its_chain() -> None:
    """The terms/rates split must not weaken the rule it sits beside."""
    rate = Evidence(
        source="defillama", label="aave_supply_apy_bps_mainnet", value=Decimal("348"), chain_id=8453
    )
    assert "Base mainnet" in rate.describe()


# ── the dedicated model alias ────────────────────────────────────────────────


def test_from_env_really_does_discard_its_model_argument_on_the_gateway_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The trap, demonstrated rather than described.

    `AsyncClaudeClient.from_env(model=...)` looks like it selects an alias. On the gateway path it
    discards the argument and uses `gateway_from_env()`'s alias instead — so the job would have
    kept running on the users' chat alias while the code read as though it had its own."""
    from sparkpoint_agent.llm.client import AsyncClaudeClient

    monkeypatch.setenv("LITELLM_BASE_URL", "http://gateway.invalid")
    monkeypatch.setenv("LITELLM_API_KEY", "sk-test")
    monkeypatch.setenv("LITELLM_MODEL", "sparkpoint-chat")

    ignored = AsyncClaudeClient.from_env(model="sparkpoint-selfauthor")
    assert ignored.model == "sparkpoint-chat", "the argument is discarded — this is the trap"


def test_the_job_actually_gets_its_own_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    """The behaviour that matters: the client this job builds asks the gateway for ITS alias."""
    monkeypatch.setenv("LITELLM_BASE_URL", "http://gateway.invalid")
    monkeypatch.setenv("LITELLM_API_KEY", "sk-test")
    monkeypatch.setenv("LITELLM_MODEL", "sparkpoint-chat")

    client = self_authoring_runner._llm()
    assert client.model == "sparkpoint-selfauthor"


def test_the_alias_is_overridable_without_a_deploy(monkeypatch: pytest.MonkeyPatch) -> None:
    """A rollback should be an env change, not a release."""
    monkeypatch.setenv("LITELLM_BASE_URL", "http://gateway.invalid")
    monkeypatch.setenv("LITELLM_API_KEY", "sk-test")
    monkeypatch.setenv("SELF_AUTHORING_MODEL_ALIAS", "sparkpoint-chat-premium")
    assert self_authoring_runner._llm().model == "sparkpoint-chat-premium"


def test_the_job_asks_for_its_own_alias_and_it_is_overridable() -> None:
    assert self_authoring_runner.DEFAULT_SELF_AUTHORING_ALIAS == "sparkpoint-selfauthor"
    assert self_authoring_runner.self_authoring_alias() == "sparkpoint-selfauthor"


def test_the_job_never_falls_back_onto_the_users_chat_alias() -> None:
    """Copying premium's fallback would reintroduce exactly the coupling the dedicated alias
    removes. A failed run writes nothing, which is already the safe outcome.

    Scans the CODE with docstrings and comments stripped — the first version of this test matched
    the very comment explaining the ban, which is a test that reads correctly and checks nothing.
    """
    assert "sparkpoint-chat" not in _code_only(self_authoring_runner)


def test_a_writer_that_returns_nothing_is_COUNTED_not_silent() -> None:
    """A misconfigured alias degrades every document to figures-only. That is a reasonable outcome
    and an invisible one — it looks exactly like a quiet day."""
    from sparkpoint_agent.selfauthor import run as run_module

    src = inspect.getsource(run_module.execute_run)
    assert "documentsWithoutProse" in src
    assert "selfauthor_prose_missing" in src


# ── two defects from the alias cutover ───────────────────────────────────────


def test_an_interrupted_run_is_swept_at_boot() -> None:
    """Observed on run 5: the container was replaced mid-run, the row stayed open, and the console
    showed "Running…" indefinitely while the NEXT run took the lock and finished in under a minute.
    A dead run must not be indistinguishable from a live one."""
    src = _code_only(self_authoring_runner)
    assert "close_orphaned_runs" in src, "the boot path must sweep interrupted runs"


def test_the_sweep_cannot_close_a_genuinely_running_run() -> None:
    """A live run is bounded by the retry budget — roughly a minute per document, six documents.
    The threshold has to sit far outside that, so a second process booting can never close one."""
    from sparkpoint_agent.db.self_authoring import SelfAuthoringStore

    sig = inspect.signature(SelfAuthoringStore.close_orphaned_runs)
    assert sig.parameters["older_than_minutes"].default >= 30


_HEAD = "# T\n\nSource: a note.\n\nThe purpose."
_FIGURES = "\n\n**In the live market**\n\n- x"


@pytest.mark.parametrize(
    ("markdown", "expected"),
    [
        (_HEAD + _FIGURES, False),
        (_HEAD + "\n\nRates moved." + _FIGURES, True),
        ("", False),
    ],
)
def test_a_prose_less_document_is_detectable_from_its_text(markdown: str, expected: bool) -> None:
    """Derived from the text, not recorded as a flag: a flag has to be kept in step with every
    rewrite, and the one place it went stale would be the place it mattered."""
    from sparkpoint_agent.selfauthor.run import _has_prose

    assert _has_prose(markdown) is expected


def test_a_run_repairs_prose_less_documents_even_when_nothing_moved() -> None:
    """The free-model runs left every document with figures and no prose. Without this, the next
    healthy run reports `no_change` and walks straight past them — degraded forever, until a rate
    happens to move by itself."""
    from sparkpoint_agent.selfauthor import run as run_module

    src = _code_only(run_module.execute_run)
    assert "_has_prose" in src
    assert "selfauthor_repairing_degraded" in inspect.getsource(run_module.execute_run)
