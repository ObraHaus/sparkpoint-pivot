"""034 — Sparky's daily self-authoring.

Once a day, in the background: fetch live evidence, rewrite six living documents in place, prove the
run did no harm, and publish into the `self_authored` corpus 031 built.

The package is split so the guarantees are testable. `evidence`, `allowlist`, `claims`, `documents`
and `settings` are PURE — no network, no database — because "an empty allowlist permits nothing",
"a held finding blocks a claim" and "a figure without a chain is not publishable" are properties of
pure functions, and that is how they stay true when the fetchers are rewritten.

NON-CUSTODY. This package writes text. Nothing in it is read by the policy gate, by `build_action`,
by the recommendation ranker, or by anything on the withdraw/exit path — asserted by
`tests/selfauthor/test_constitution_boundary.py`, not merely intended.
"""
