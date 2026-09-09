# ruff: noqa: S101
"""The `/readyz` check names are a CONTRACT with the admin System console.

They have moved once already, and it cost weeks of a false alarm. Feature 023 renamed `base_rpc` to
`chain_rpc` and added `chain_identity`; the console kept reading `base_rpc`, the field was optional
on its side, and a missing optional field rendered as **"Down"**. From 2026-07-30 the System page
reported a Base RPC outage continuously while the RPC was entirely healthy — verified when it was
finally investigated: chain 84532, block 44,998,642, and the agent reading the next block a second
later.

Nothing errored. Nothing was logged. The one screen an operator checks during an incident was
confidently wrong, and the only reason anyone noticed was that a person looked at it and asked.

So both ends now pin the names. Renaming a check is fine — it just has to be a decision, taken
with the console in view, rather than something that quietly half-lands.

The console reads these in `apps/web/src/lib/admin/systemTiles.ts` (`EXPECTED_CHECKS`).
"""

from __future__ import annotations

import inspect

from sparkpoint_agent.api import main

#: Exactly what the admin System console renders a tile for.
CONSOLE_EXPECTS = {"chain_rpc", "chain_identity", "sim_fork", "llm", "postgres"}


def test_readyz_emits_exactly_the_checks_the_console_renders() -> None:
    source = inspect.getsource(main.readyz)
    start = source.index("checks = {")
    end = source.index("}", start)
    emitted = {
        line.split('"')[1]
        for line in source[start:end].split("\n")
        if line.strip().startswith('"')
    }
    assert emitted == CONSOLE_EXPECTS, (
        "the /readyz check names have drifted from what the admin System console reads.\n"
        f"  agent emits : {sorted(emitted)}\n"
        f"  console reads: {sorted(CONSOLE_EXPECTS)}\n"
        "A key the console does not know about renders as an outage that is not happening — see "
        "apps/web/src/lib/admin/systemTiles.ts. Rename on both sides, in the same change."
    )


def test_the_renamed_key_is_really_gone() -> None:
    """`base_rpc` keyed off an env var name rather than the chain actually being served, which was
    wrong in both directions on mainnet. It should not come back.

    Scans the CODE with the docstring stripped: the docstring EXPLAINS the rename and names the old
    key, so a plain source scan matches the very prose describing the rule and fails for the wrong
    reason. (The same trap caught a test earlier in this feature.)
    """
    import ast

    tree = ast.parse(inspect.getsource(main.readyz).lstrip())
    fn = tree.body[0]
    assert isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef))
    body = fn.body
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
        fn.body = body[1:]
    assert "base_rpc" not in ast.unparse(tree)
