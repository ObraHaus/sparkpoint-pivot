# ruff: noqa: S101  (pytest asserts)
"""053 — the flow-indexer cursor stream must be chain-scoped.

All flow rows live under the shared ``"base"`` mirror network id, so a single ``vault_flows``
watermark shared by two chains lets the higher-blocked chain push the other past its head and
silently freeze its indexing. The stream therefore carries the chain whenever the agent is not
on its configured vault chain.
"""

from __future__ import annotations

from sparkpoint_agent.api.main import flow_cursor_stream
from sparkpoint_agent.config import AgentConfig


def _config(chain_id: int, vault: str | None) -> AgentConfig:
    return AgentConfig(chain_id=chain_id, rpc_url=None, vault_address=vault, database_url=None)


def test_configured_vault_chain_keeps_the_historical_stream() -> None:
    assert flow_cursor_stream(_config(8453, "0xV")) == "vault_flows"


def test_a_chain_without_the_vault_gets_its_own_stream() -> None:
    assert flow_cursor_stream(_config(4663, None)) == "vault_flows_4663"
    assert flow_cursor_stream(_config(46630, None)) == "vault_flows_46630"
