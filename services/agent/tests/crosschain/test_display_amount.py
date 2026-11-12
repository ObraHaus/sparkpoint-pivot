# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
from sparkpoint_agent.crosschain.service import display_amount


def test_quote_prose_amount_is_truncated_to_six_decimals() -> None:
    assert display_amount("0.287170497495498417721517") == "0.28717"
    assert display_amount("0.2899499999999") == "0.289949"
    assert display_amount("12") == "12"
    assert display_amount("1.500000") == "1.5"
    assert display_amount("0.0000001") == "0"
    assert display_amount("n/a") == "n/a"
