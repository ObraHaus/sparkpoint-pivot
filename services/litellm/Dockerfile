# SparkPoint LiteLLM gateway (develop). Pins the stable LiteLLM proxy image and bakes in the
# config; all secrets (OPENROUTER_API_KEY, LITELLM_MASTER_KEY, DATABASE_URL) come from the
# Coolify env at runtime — NONE are in this image or the config file.
#
# The gateway is the ONLY holder of the OpenRouter key. Hermes reaches it with a virtual key.
FROM ghcr.io/berriai/litellm:main-stable

# The proxy config (model_list → openrouter alias). Secrets are os.environ/… references only.
COPY config.yaml /app/config.yaml

# Serve on 4000 (Coolify routes the FQDN here). Docs/UI hardening is applied via env
# (DISABLE_ADMIN_UI) — the master key already gates every functional endpoint.
EXPOSE 4000
CMD ["--config", "/app/config.yaml", "--port", "4000", "--num_workers", "1"]
