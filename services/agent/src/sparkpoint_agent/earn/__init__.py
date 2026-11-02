"""Feature 069 — Morpho yield via NEAR Intents, driven by config + a data snapshot.

The package answers one question honestly: which Morpho vaults can this deployment reach, by
which rail, and what would a preview look like? "Support all Morpho vaults" is a DATA question:
the shipped ``earn.json`` enables chains and filters, and ``snapshot.json`` carries the vaults
fetched from Morpho's API. No vault address is hard-coded into a request handler, and Morpho's
rate-limited API is only ever touched from a background refresher or a script.

Non-custody: nothing here signs, holds a key or moves funds. A preview is a DRY 1Click quote or a
step plan rendered as data; the user always signs in their own wallet.
"""

from __future__ import annotations

__all__: list[str] = []
