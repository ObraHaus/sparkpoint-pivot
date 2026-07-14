# SparkPoint Hermes agent — Python 3.12 + uv. Holds no keys; runs read/derive
# + the deterministic policy gate. Deployed to the Coolify develop pair (R15).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONPATH=/app/src

COPY pyproject.toml ./
RUN uv pip install --system fastapi "uvicorn[standard]" pydantic httpx anthropic

COPY src ./src
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz').status==200 else 1)"
CMD ["uvicorn", "sparkpoint_agent.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
