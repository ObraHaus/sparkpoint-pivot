# SparkPoint Hermes agent — Python 3.12 + uv. Holds no keys; runs read/derive
# + the deterministic policy gate + the advisory assistant. Deployed to the
# Coolify develop pair (R15). Build context = services/agent (self-contained:
# the vault ABI is vendored under src/…/chain/abi so no monorepo path is needed).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONPATH=/app/src

# Runtime deps (mirror pyproject [project.dependencies]; asyncpg = DB, eth-abi =
# the keyless vault chain-reader). Kept explicit so the image stays slim.
COPY pyproject.toml ./
RUN uv pip install --system \
      fastapi "uvicorn[standard]" pydantic httpx anthropic asyncpg eth-abi

COPY src ./src

# The seed corpora the admin reingest endpoints load at runtime (resolved relative to /app):
#   knowledge_seed      -> /app/knowledge_seed      (Obsidian RAG corpus; /admin/knowledge/reingest)
#   knowledge_seed_tips -> /app/knowledge_seed_tips (sidebar tip databank; /admin/tips/reingest)
# Without these in the image the reingest endpoints find no notes and ingest 0.
COPY knowledge_seed ./knowledge_seed
COPY knowledge_seed_tips ./knowledge_seed_tips

# The vendored, forge-build-free vault ABI the chain-reader loads (T015 export).
ENV SPARKPOINT_VAULT_ABI_PATH=/app/src/sparkpoint_agent/chain/abi/SparkPointVault.abi.json

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"
CMD ["uvicorn", "sparkpoint_agent.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
