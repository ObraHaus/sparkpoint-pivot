# ruff: noqa: S101
"""034 — the line this feature must not cross, asserted rather than merely intended.

031 made `self_authored` RETRIEVABLE. This feature makes it GENERATED. That is a real change in
kind: the product now contains a writer, and the product's entire trust proposition is that the
assistant proposes while a deterministic policy and the user dispose.

Constitution Principle VII is explicit — *discretionary curation by SparkPoint (market selection,
cap-setting, allocation) remains FORBIDDEN* — and Principle II keeps the decision path free of
model output. Generated text that could rank a recommendation, widen an allowlist, or influence
what may be signed would be the assistant curating.

So these tests are structural. They do not check that the current code happens to behave; they check
that the wiring which would allow the violation does not exist.
"""

from __future__ import annotations

import inspect
from pathlib import Path

from sparkpoint_agent.selfauthor import (
    claims,
    documents,
    evidence,
    run,
    selfcheck,
    settings,
    sources,
    writer,
)

PACKAGE_MODULES = (claims, documents, evidence, run, selfcheck, settings, sources, writer)

#: Anything that decides what a user may do, may be shown as a recommendation, or may be signed.
DECISION_PATH = (
    "sparkpoint_agent.policy",
    "sparkpoint_agent.agents.recommender",
    "sparkpoint_agent.agents.planner",
    "sparkpoint_agent.execution",
    "build_action",
    "build_tx",
    # `policy.evaluate`, qualified — a bare "evaluate(" also matches this package's OWN
    # selfcheck.evaluate, which is a pure predicate over search hits and reaches nothing.
    "policy.evaluate",
    "PolicyDecision",
    "session_key",
    "signature",
)


def test_no_module_in_this_package_imports_the_decision_path() -> None:
    """The structural assertion. A self-authored document is reference material; if this package
    could reach the policy gate, "reference material" would be a convention rather than a fact."""
    offenders: list[str] = []
    for module in PACKAGE_MODULES:
        source = inspect.getsource(module)
        for marker in DECISION_PATH:
            if marker in source:
                offenders.append(f"{module.__name__}: {marker}")
    assert not offenders, (
        "self-authoring must not be able to reach anything that decides what a user may do:\n  "
        + "\n  ".join(offenders)
    )


def test_nothing_in_the_decision_path_reads_self_authoring() -> None:
    """The other direction, which is the one that would actually do harm."""
    root = Path(inspect.getfile(run)).resolve().parents[1]
    offenders: list[str] = []
    for area in ("policy", "agents", "execution"):
        directory = root / area
        if not directory.exists():
            continue
        for path in directory.rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            if "selfauthor" in text or "self_authoring" in text:
                offenders.append(str(path.relative_to(root)))
    assert not offenders, (
        "the decision path must not read self-authored material — AI proposes, deterministic "
        f"policy disposes: {offenders}"
    )


def test_the_package_never_touches_the_withdraw_or_exit_path() -> None:
    """N2: the exit is always open and never slowed. This job runs in the background and must not
    appear anywhere near it."""
    for module in PACKAGE_MODULES:
        source = inspect.getsource(module).lower()
        for forbidden in ("withdraw(", "redeem(", "/exit", "exit_path"):
            assert forbidden not in source, f"{module.__name__} references {forbidden}"


def test_the_package_holds_no_key_and_signs_nothing() -> None:
    """N1/N3. This feature writes text."""
    for module in PACKAGE_MODULES:
        source = inspect.getsource(module).lower()
        secrets = ("private_key", "privatekey", "sign_typed", "eth_sendtransaction", "mnemonic")
        for forbidden in secrets:
            assert forbidden not in source, f"{module.__name__} references {forbidden}"


def test_the_curated_morpho_allowlist_is_not_readable_from_here() -> None:
    """Constitution IV.5(d): the curated allowlist is consumed ONLY by the factory at deploy time
    and MUST NOT be readable by the policy, session-key, or agent strategy path. Describing the
    Morpho landscape is permitted; selecting from it is not."""
    for module in PACKAGE_MODULES:
        source = inspect.getsource(module)
        assert "curated" not in source.lower() or "curation" in source.lower(), module.__name__
        assert "vault_registry" not in source, module.__name__
        assert "VaultFactory" not in source, module.__name__


def test_the_writer_is_told_not_to_recommend() -> None:
    """The model-facing half of the same boundary. Structure keeps generated text out of the
    decision path; this keeps the text itself from reading like a decision."""
    assert "Never recommend an action, an allocation, or a product" in writer.SYSTEM
    assert "reference material" in writer.SYSTEM


def test_the_persona_is_not_touched() -> None:
    """Persona is trusted SYSTEM instruction text with no source kind, deliberately never part of
    the retrievable corpus. A feature that GENERATES corpus content must not be able to write it."""
    for module in PACKAGE_MODULES:
        assert "persona" not in inspect.getsource(module).lower(), module.__name__


def test_documents_are_written_only_under_the_self_authored_kind() -> None:
    """A run that could write into `knowledge` would let generated text impersonate documentation a
    person wrote and checked — and the citation label, which is the reader's only defence, is
    chosen from the source kind."""
    for module in PACKAGE_MODULES:
        source = inspect.getsource(module)
        for kind in ('"knowledge"', "'knowledge'", '"tip"', '"changelog"'):
            if kind in source and module is not selfcheck:
                raise AssertionError(f"{module.__name__} names the {kind} source kind")
