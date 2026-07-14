"""SparkPoint Hermes agent service.

The runtime orchestration layer: a deterministic Coordinator DAG drives five
scoped agents; the LLM-free policy engine gates every signable artifact; the
self-hosted Anvil-fork Simulator runs the pre-trade simulation. The service
holds no user keys and returns only unsigned, simulated, policy-approved
IntentBundles.
"""

__version__ = "0.0.0"
