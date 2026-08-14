# Published revenue allocations (feature 044)

One JSON per closed period: `<chainId>/period-N.json`.

**This is the public record, not a cache.** It carries every input a period's split was computed
from — the pot, each wallet's weight, which brokers produced it, and the Merkle proof — so anyone
can recompute the root and check it against `BrokerRevenueDistributor`'s on-chain commitment. The
contract stores only the root; without these files a holder cannot claim and nobody can audit the
split.

Written by `services/agent/scripts/build_period_allocation.py`, which reads live chain state and
refuses to emit anything it could not read completely.

⚠️ **It lives here, and only here.** It is tempting to keep a "canonical" copy at the repo root and
copy it in at build time; that produces two files that can disagree about who is owed what. This
directory is committed and versioned like any other artifact *and* is the path actually served.

⚠️ **`/allocations/` is allowlisted in `middleware.ts` so it needs no session.** That is the point:
an artifact you have to log in to read is not a public record. Anything else machine-fetchable added
to `apps/web` gets a silent 307 to `/coming-soon`.

⚠️ **Never edit a file here by hand.** A period's root is published on-chain and immutable; editing
the document does not change the root, it just makes the proofs stop verifying.
