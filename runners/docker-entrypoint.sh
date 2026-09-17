#!/bin/sh
# Container entrypoint for the keeper/sweeper.
#
# ⚠️ The address book is a FILE the runners read at DEPLOYMENT_PATH — but this Coolify version exposes
# no file-mount API, and `DeployCompanion` writes no book into the image. So the book may instead be
# supplied as a base64 env var (`DEPLOYMENT_JSON_B64`), exactly the way the app carries its own book,
# and materialized here at start-up before the runner boots. When the var is unset this is a no-op and
# the runner uses whatever file is already at DEPLOYMENT_PATH (a real mount, or a baked file).
set -e

if [ -n "$DEPLOYMENT_JSON_B64" ]; then
  book="${DEPLOYMENT_PATH:-/app/deployments/mainnet.json}"
  mkdir -p "$(dirname "$book")"
  printf '%s' "$DEPLOYMENT_JSON_B64" | base64 -d > "$book"
fi

# `exec` so node becomes PID 1's child under tini and receives signals directly. SERVICE selects the
# runner (keeper|sweeper); the healthcheck reads the same SERVICE.
exec node --experimental-strip-types "src/${SERVICE}.ts"
