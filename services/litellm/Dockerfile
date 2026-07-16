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

# Serve on 4000 (Coolify routes the FQDN here). Docs/UI hardening is applied via env
# (DISABLE_ADMIN_UI) — the master key already gates every functional endpoint.
EXPOSE 4000
CMD ["--config", "/app/config.yaml", "--port", "4000", "--num_workers", "1"]
