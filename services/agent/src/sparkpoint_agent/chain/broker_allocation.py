"""Turns a period's pot into a per-wallet Merkle allocation (feature 044).

This computes who gets what when a revenue period closes, and commits it as a Merkle root the
distributor can verify. It is the trust surface of the whole feature: the contract cannot check
that a split is *fair*, only that a claim matches the root it was given. So the rules here are the
guarantee, and the published inputs (`AllocationPlan.to_publishable`) are what makes the claim
checkable by someone who does not trust us.

**The split.** Every activated broker gets `pot * weightBps / totalWeightBps`. Weights are
1.0× / 2.0× / 3.3× as 10000 / 20000 / 33000 bps. Integer division truncates, so the sum is always
*at or under* the pot — never over, which is the direction that matters: the distributor refuses to
promise more than it holds, and an allocation that rounded up would be rejected on publication.

**Dust rolls forward.** The truncated remainder stays in the contract and raises `available()` for
the next period. It is never swept anywhere, because there is nothing that can sweep it.

⚠️ **A leaf binds a WALLET, not a broker.** One wallet holding three activated brokers gets ONE leaf
for the sum of all three — otherwise `claim`'s once-per-period-per-account rule would let them claim
only the first. This is why holders are grouped before the tree is built, and why the ledger
lowercases addresses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from eth_abi import encode as abi_encode
from eth_utils import keccak

from sparkpoint_agent.chain.broker_ledger import ActivatedBroker


@dataclass(frozen=True)
class WalletAllocation:
    """What one wallet is owed for one period, and the proof that lets them take it."""

    account: str
    amount: int
    #: Which brokers produced it — published so a holder can check their own arithmetic.
    token_ids: tuple[int, ...]
    weight_bps: int
    proof: tuple[str, ...] = ()


@dataclass(frozen=True)
class AllocationPlan:
    period_id: int
    token: str
    pot: int
    total_weight_bps: int
    total_allocated: int
    #: Truncation remainder. Rolls into the next period; goes nowhere else.
    dust: int
    merkle_root: str
    allocations: tuple[WalletAllocation, ...]

    def to_publishable(self) -> dict[str, Any]:
        """The inputs anyone needs to recompute this root independently (FR-010).

        A split of other people's money should be checkable rather than trusted, so this carries
        every inpu the computation used — not just the outcome.
        """
        return {
            "periodId": self.period_id,
            "token": self.token,
            "pot": str(self.pot),
            "totalWeightBps": self.total_weight_bps,
            "totalAllocated": str(self.total_allocated),
            "dust": str(self.dust),
            "merkleRoot": self.merkle_root,
            "allocationCount": len(self.allocations),
            "rule": "amount = pot * weightBps / totalWeightBps, truncated; remainder rolls over",
            "leaf": "keccak256(abi.encode(uint256 periodId, address account, uint256 amount))",
            "allocations": [
                {
                    "account": a.account,
                    "amount": str(a.amount),
                    "weightBps": a.weight_bps,
                    "tokenIds": list(a.token_ids),
                    "proof": list(a.proof),
                }
                for a in self.allocations
            ],
        }


def leaf_for(period_id: int, account: str, amount: int) -> bytes:
    """`keccak256(abi.encode(periodId, account, amount))` — identical to the contract's `leafFor`.

    ⚠️ `abi.encode`, NOT `abi.encodePacked`. This is the classic Merkle-distributor footgun: the two
    produce different hashes, every proof fails, and the failure looks like "bad proof" rather than
    "wrong encoding". A test proves this function against the deployed contract rather than against
    a second copy of my own assumption.
    """
    return keccak(abi_encode(["uint256", "address", "uint256"], [period_id, account, amount]))


def _hash_pair(a: bytes, b: bytes) -> bytes:
    """OpenZeppelin `MerkleProof` sorts each pair, so proofs carry no left/right flags."""
    return keccak(a + b) if a < b else keccak(b + a)


def build_tree(leaves: list[bytes]) -> tuple[bytes, list[list[bytes]]]:
    """Returns `(root, levels)`. An odd node is promoted, matching OZ's standard construction."""
    if not leaves:
        return b"\x00" * 32, [[]]
    levels: list[list[bytes]] = [sorted(leaves)]
    while len(levels[-1]) > 1:
        current = levels[-1]
        nxt: list[bytes] = []
        for i in range(0, len(current), 2):
            if i + 1 < len(current):
                nxt.append(_hash_pair(current[i], current[i + 1]))
            else:
                nxt.append(current[i])  # promoted unchanged
        levels.append(nxt)
    return levels[-1][0], levels


def proof_for(levels: list[list[bytes]], leaf: bytes) -> list[bytes]:
    proof: list[bytes] = []
    idx = levels[0].index(leaf)
    for level in levels[:-1]:
        sibling = idx ^ 1
        if sibling < len(level):
            proof.append(level[sibling])
        idx //= 2
    return proof


class UnpricedActivations(Exception):
    """Raised when brokers are activated but carry no weight, and nobody has decided what to do.

    ⚠️ This is a REFUSAL, not an error to catch and ignore. A broker whose `activatedAt` is non-zero
    belongs to a holder who paid; if no registry can price it, building the split anyway allocates
    them nothing — permanently, because a published period is immutable.

    Live example: Robinhood testnet brokers #1 and #4 are activated on the NFT while both superseded
    registries predate the 043c tiers and expose no `weightOf` at all, so the call reverts. The
    registry list cannot rescue them; there is no weight recorded anywhere.

    Resolve it deliberately — treat pre-tier activations as Analyst (1.0x), require re-activation,
    or pass `allow_unpriced=True` to exclude them knowingly and on the record.
    """

    def __init__(self, token_ids: tuple[int, ...]) -> None:
        super().__init__(
            f"{len(token_ids)} broker(s) are activated but carry no weight: {list(token_ids)}. "
            "Building a split now would allocate their holders nothing, permanently. Decide first, "
            "or pass allow_unpriced=True to exclude them knowingly."
        )
        self.token_ids = token_ids


def build_allocation(
    *,
    period_id: int,
    token: str,
    pot: int,
    brokers: list[ActivatedBroker],
    weightless: tuple[int, ...] = (),
    allow_unpriced: bool = False,
) -> AllocationPlan:
    """Compute a period's split. Pure — no chain access, so it is fully testable.

    `brokers` must be the COMPLETE set of activated brokers at close. The ledger returns ``None``
    rather than a partial list precisely so that a short list cannot reach this function: anyone
    missing here is silently allocated nothing, and publication makes that permanent.

    `weightless` carries `ActivationScan.weightless` — brokers that are activated but unpriceable.
    Passing them is what makes excluding them a DECISION rather than an accident.
    """
    if weightless and not allow_unpriced:
        raise UnpricedActivations(tuple(weightless))
    total_weight = sum(b.weight_bps for b in brokers)

    # A period with revenue but nobody to pay is a normal state, not an error. Nothing is allocated
    # and the whole pot rolls into the next period.
    if total_weight == 0 or pot == 0:
        root, _ = build_tree([])
        return AllocationPlan(
            period_id=period_id,
            token=token,
            pot=pot,
            total_weight_bps=total_weight,
            total_allocated=0,
            dust=pot,
            merkle_root="0x" + root.hex(),
            allocations=(),
        )

    # Group by wallet FIRST — see the module docstring: one wallet is one leaf, always.
    by_wallet: dict[str, list[ActivatedBroker]] = {}
    for b in brokers:
        by_wallet.setdefault(b.holder.lower(), []).append(b)

    rows: list[WalletAllocation] = []
    for account in sorted(by_wallet):
        held = by_wallet[account]
        weight = sum(b.weight_bps for b in held)
        rows.append(
            WalletAllocation(
                account=account,
                amount=pot * weight // total_weight,  # truncates ⇒ never over-promises
                token_ids=tuple(sorted(b.token_id for b in held)),
                weight_bps=weight,
            )
        )

    # A wallet allocated 0 (a pot too small to divide) gets no leaf: a claim for 0 would cost gas
    # and move nothing.
    rows = [r for r in rows if r.amount > 0]

    leaves = [leaf_for(period_id, r.account, r.amount) for r in rows]
    root, levels = build_tree(leaves)

    with_proofs = tuple(
        WalletAllocation(
            account=r.account,
            amount=r.amount,
            token_ids=r.token_ids,
            weight_bps=r.weight_bps,
            proof=tuple("0x" + p.hex() for p in proof_for(levels, leaf)),
        )
        for r, leaf in zip(rows, leaves, strict=True)
    )

    total_allocated = sum(r.amount for r in with_proofs)
    return AllocationPlan(
        period_id=period_id,
        token=token,
        pot=pot,
        total_weight_bps=total_weight,
        total_allocated=total_allocated,
        dust=pot - total_allocated,
        merkle_root="0x" + root.hex(),
        allocations=with_proofs,
    )
