# ruff: noqa: S101
"""034 — a guard against the mistake this suite already made once.

An earlier version of `test_run.py` allowed every data source and, with no explicit stub, quietly
reached the LIVE DeFiLlama API. It passed. It would have kept passing until the day that API was
slow, rate-limited, or simply changed its numbers — and then it would have failed for a reason
having nothing to do with the code under test.

A test that touches the network is not testing what its name says. This guard makes the fetchers
prove they are reachable only through an injected client, so a future test cannot make the same
mistake without noticing.
"""

from __future__ import annotations

import inspect

from sparkpoint_agent.selfauthor import sources


def test_every_network_fetcher_accepts_an_injectable_client() -> None:
    """Injectable, so a test can stub it. A fetcher that always constructs its own client is a
    fetcher no test can isolate."""
    for name in ("fetch_defillama", "fetch_prose"):
        signature = inspect.signature(getattr(sources, name))
        assert "client" in signature.parameters, f"{name} cannot be isolated in a test"


def test_the_prose_fetcher_refuses_before_it_opens_a_connection() -> None:
    """The allowlist check happens BEFORE any client is constructed, so a refused URL costs no
    request at all — which is also why a refusal is instant rather than a timeout."""
    source = inspect.getsource(sources.fetch_prose)
    check_at = source.index("check_url(")
    # The CONSTRUCTION, not the type annotation in the signature — which naturally appears first
    # and would make this assertion look like it was checking something it was not.
    construct_at = source.index("httpx.AsyncClient(")
    assert check_at < construct_at, "the allowlist must be consulted before a connection is opened"


def test_no_fetcher_follows_redirects_across_hosts() -> None:
    """A permitted host that redirects to an unpermitted one would otherwise launder the
    allowlist."""
    assert "follow_redirects=False" in inspect.getsource(sources.fetch_prose)
