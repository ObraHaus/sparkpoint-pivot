# SparkPoint LiteLLM gateway (develop). Pins the stable LiteLLM proxy image and bakes in the
# config; all secrets (OPENROUTER_API_KEY, LITELLM_MASTER_KEY, DATABASE_URL) come from the
# Coolify env at runtime — NONE are in this image or the config file.
#
# The gateway is the ONLY holder of the OpenRouter key. Hermes reaches it with a virtual key.
# Pinned to a digest (not the moving `main-stable` tag) for reproducible builds — resolved
# 2026-07-16 from ghcr.io/berriai/litellm:main-stable. Bump deliberately.
FROM ghcr.io/berriai/litellm@sha256:9ef6f45bc0104940571765e610c52a1d761b5ec85efcd193795281086ee61277

# The proxy config (model_list → openrouter alias). Secrets are os.environ/… references only.
COPY config.yaml /app/config.yaml
# Guard reverse-proxy: LiteLLM runs on :4001; the guard fronts it on :4000 and 404s the anonymous
# UI/schema surfaces (/, /ui, /openapi.json, /docs, /redoc) that main-stable can't disable by env.
COPY guard.py /app/guard.py
COPY entrypoint.sh /app/entrypoint.sh

EXPOSE 4000
# Override the image entrypoint so we run litellm(:4001) + the guard(:4000) instead of litellm alone.
ENTRYPOINT []
CMD ["sh", "/app/entrypoint.sh"]
