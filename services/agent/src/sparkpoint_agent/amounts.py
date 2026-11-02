"""Shared bounds for human-entered amounts, applied BEFORE smallest-unit conversion.

``Decimal`` keeps an arbitrarily large exponent without materialising its digits, so a value such
as ``1e999999000`` is cheap to parse and finite, but ``int(amount.scaleb(decimals))`` would then
build a ~1e9-digit integer and exhaust CPU/RAM. Every amount that reaches ``scaleb``/``int`` must
therefore pass the bounds below — in the HTTP API (``amount_from_human``) and in the deterministic
chat parsers alike.

The magnitude cap is deliberately far above any real token amount. Even the largest supplies in
existence are many orders of magnitude below it: 1e31 human units is ~1e16 × the total crypto
market cap expressed in whole units, so it cannot reject a legitimate token amount while still
bounding the converted integer to ~37 digits at 6 decimals (~49 at 18).
"""

from __future__ import annotations

from decimal import Decimal, DecimalException, InvalidOperation

#: A human amount longer than this is rejected before ``Decimal`` ever sees it. It still admits
#: every realistic shape (``"1,234,567,890.123456789012345678"`` is 33 chars).
MAX_AMOUNT_TEXT_LENGTH = 64

#: ``Decimal.adjusted()`` is the exponent of the most significant digit, i.e. ``floor(log10)``.
#: ``30`` allows up to ``9.99…e30`` (just under 1e31) and rejects ``1e31`` and anything larger.
MAX_AMOUNT_ADJUSTED_EXPONENT = 30


def bounded_smallest_units(
    text: str,
    decimals: int,
    *,
    multiplier: Decimal = Decimal(1),
) -> tuple[Decimal, int] | None:
    """Parse human amount text into ``(Decimal, smallest-unit int)``, or ``None`` if unsafe.

    Rejects — before any ``scaleb``/``int`` conversion — empty/over-long text, non-finite values,
    non-positive values, a magnitude above :data:`MAX_AMOUNT_ADJUSTED_EXPONENT`, and values with
    more fractional digits than the token supports. The returned integer is therefore bounded.
    """
    stripped = text.strip()
    if not stripped or len(stripped) > MAX_AMOUNT_TEXT_LENGTH:
        return None
    try:
        amount = Decimal(stripped.replace(",", ""))
    except (InvalidOperation, ValueError):
        return None
    if not amount.is_finite() or amount <= 0:
        return None
    if amount.adjusted() > MAX_AMOUNT_ADJUSTED_EXPONENT:
        return None
    if multiplier != 1:
        try:
            amount *= multiplier
        except DecimalException:
            return None
        if amount.adjusted() > MAX_AMOUNT_ADJUSTED_EXPONENT:
            return None
    exponent = amount.as_tuple().exponent
    if isinstance(exponent, int) and -exponent > decimals:
        return None
    try:
        raw = int(amount.scaleb(decimals))
    except (DecimalException, ValueError, OverflowError):
        return None
    if raw <= 0:
        return None
    return amount, raw
