#!/bin/sh
# Start LiteLLM on an INTERNAL port (4001) and front it with the guard proxy on the exposed
# port (4000). Traefik → guard:4000 → (block UI/schema | proxy → litellm:4001). LiteLLM still
# runs its own prisma migrations + master-key auth; the guard only hides the anonymous surfaces.
set -e

litellm --config /app/config.yaml --port 4001 --num_workers 1 &
LITELLM_PID=$!

# Wait for LiteLLM to accept connections before the guard starts taking traffic.
i=0
while [ "$i" -lt 90 ]; do
  if python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4001/health/liveliness', timeout=2).status==200 else 1)" 2>/dev/null; then
    break
  fi
  # If LiteLLM died, don't hang — exit so the platform restarts the container.
  kill -0 "$LITELLM_PID" 2>/dev/null || { echo "litellm exited before ready" >&2; exit 1; }
  i=$((i + 1))
  sleep 2
done

exec python /app/guard.py
