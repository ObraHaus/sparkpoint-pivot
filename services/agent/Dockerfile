# SparkPoint Hermes agent — Python 3.12 + uv. Holds no keys; runs read/derive
# + the deterministic policy gate + the advisory assistant. Deployed to the
# Coolify develop pair (R15). Build context = services/agent (self-contained:
# the vault ABI is vendored under src/…/chain/abi so no monorepo path is needed).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONPATH=/app/src

# Runtime deps. ⚠️ This list MUST match `[project.dependencies]` in pyproject.toml, and a guard
# test (`tests/test_dockerfile_deps.py`) fails the build if it drifts.
#
# It drifted once, and the failure was invisible: `eth-hash[pycryptodome]` was declared in
# pyproject but missing here, so `eth_utils.keccak` had no hashing backend in the image. The vault
# fee indexer computes its event topics with keccak AT IMPORT TIME, so its background task raised
# ImportError on creation — and `asyncio.create_task` swallows that. No error, no cursor movement,
# and `/admin/revenue` read zero for a day while looking perfectly healthy.
#
# The lesson is not "remember to update two files". It is that a hand-maintained mirror of a
# dependency list is a mirror that will eventually lie, so it is now asserted.
COPY pyproject.toml ./
RUN uv pip install --system \
      fastapi "uvicorn[standard]" pydantic httpx anthropic asyncpg eth-abi \
      "eth-hash[pycryptodome]"

COPY src ./src

# The seed corpora loaded at runtime (resolved relative to /app):
#   knowledge_seed      -> /app/knowledge_seed      (Obsidian RAG corpus; /admin/knowledge/reingest)
#   knowledge_seed_tips -> /app/knowledge_seed_tips (sidebar tip databank; /admin/tips/reingest)
#   persona_seed        -> /app/persona_seed        (Sparky persona; composed into the literacy SYSTEM)
#   content_seed        -> /app/content_seed        (feature 006 changelog seed; /admin/content/reingest)
# Without these in the image the loaders find no files: reingest ingests 0, and the persona is empty.
COPY knowledge_seed ./knowledge_seed
COPY knowledge_seed_tips ./knowledge_seed_tips
COPY persona_seed ./persona_seed
COPY content_seed ./content_seed

# The vendored, forge-build-free vault ABI the chain-reader loads (T015 export).
ENV SPARKPOINT_VAULT_ABI_PATH=/app/src/sparkpoint_agent/chain/abi/SparkPointVault.abi.json

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"
CMD ["uvicorn", "sparkpoint_agent.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
