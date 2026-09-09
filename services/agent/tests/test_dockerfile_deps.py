# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""The Dockerfile's runtime dependency list must not drift from pyproject.

⚠️ This exists because it drifted, and the failure was invisible.

`pyproject.toml` declared `eth-hash[pycryptodome]`; the Dockerfile's hand-written
`uv pip install` list did not. So in the image `eth_utils.keccak` had **no hashing backend**.
The vault fee indexer derives its event topics with keccak *at import time*, so its background
task raised `ImportError` the moment it was created — and `asyncio.create_task` swallows an
exception nobody retrieves.

The result: no error in the logs, no cursor movement, and `/admin/revenue` reporting zero
performance-fee revenue for a day while every health check stayed green. It took a deployed
`add_done_callback` to find, because nothing else could see it.

A hand-maintained mirror of a dependency list is a mirror that will eventually lie. This asserts
it instead of trusting it.
"""

from __future__ import annotations

import pathlib
import re
import tomllib

_AGENT = pathlib.Path(__file__).resolve().parents[1]
_PYPROJECT = _AGENT / "pyproject.toml"
_DOCKERFILE = _AGENT / "Dockerfile"


def _declared_packages() -> set[str]:
    """Package names from `[project.dependencies]`, extras and version specifiers stripped."""
    data = tomllib.loads(_PYPROJECT.read_text())
    names = set()
    for dep in data["project"]["dependencies"]:
        # "eth-hash[pycryptodome]>=0.7.0" -> "eth-hash"
        name = re.split(r"[<>=!\[;~ ]", dep, maxsplit=1)[0]
        names.add(name.strip().lower().replace("_", "-"))
    return names


def _installed_packages() -> set[str]:
    """Package names from the Dockerfile's `uv pip install` invocation."""
    text = _DOCKERFILE.read_text()
    match = re.search(r"uv pip install --system\s+((?:.|\n)*?)(?=\n[A-Z#]|\n\n)", text)
    assert match, "could not find the `uv pip install --system` line in the Dockerfile"
    body = match.group(1).replace("\\\n", " ").replace("\\", " ")
    names = set()
    for token in body.split():
        token = token.strip('"').strip("'")
        if not token or token.startswith("-"):
            continue
        name = re.split(r"[<>=!\[;~]", token, maxsplit=1)[0]
        if name:
            names.add(name.strip().lower().replace("_", "-"))
    return names


def test_every_declared_dependency_is_installed_in_the_image() -> None:
    """The exact drift that broke the vault fee indexer in production."""
    declared = _declared_packages()
    installed = _installed_packages()
    missing = declared - installed
    assert not missing, (
        f"pyproject declares {sorted(missing)} but the Dockerfile does not install them. "
        "A package missing from the image fails at RUNTIME, and a background task that dies on "
        "the resulting ImportError does so silently — see the module docstring."
    )


def test_eth_hash_backend_extra_is_kept() -> None:
    """⚠️ Named explicitly, because the EXTRA is the part that matters.

    Installing bare `eth-hash` satisfies the parity check above while still leaving
    `eth_utils.keccak` with no backend — the import succeeds and the first *call* raises. The
    extra is what makes keccak work at all, so it is asserted by name rather than by package.
    """
    text = _DOCKERFILE.read_text()
    assert "eth-hash[pycryptodome]" in text, (
        "the Dockerfile must install eth-hash WITH the pycryptodome extra; bare eth-hash has no "
        "hashing backend and keccak raises at call time"
    )


def test_keccak_actually_works_here() -> None:
    """A behavioural check, not an import check.

    `import eth_utils` succeeds without a backend; only calling `keccak` fails. Asserting the
    value proves a backend is genuinely wired, which is the property the image needs.
    """
    from eth_utils import keccak

    # keccak256("") — a fixed, well-known vector.
    assert keccak(b"").hex() == (
        "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    )
