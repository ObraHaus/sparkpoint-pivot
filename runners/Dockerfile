# The Sparky beta bots, as one image. `SERVICE` picks which one this container is.
#
# ⚠️ ONE image, THREE deployments. The keeper and the sweeper differ only in their entrypoint and
# their cadence, and the curator (048, keyless — it reports to the agent and holds no wallet) shares
# the same loop/liveness contract, so building near-identical images would be things to keep in step.
# This builds once and each Coolify app sets `SERVICE=keeper` / `SERVICE=sweeper` / `SERVICE=curator`
# — which selects both the process `CMD` starts and the heartbeat the `HEALTHCHECK` reads. The two
# funded runners still run as separate apps with separate hot wallets (KEEPER_PRIVATE_KEY /
# SWEEPER_PRIVATE_KEY); the curator needs neither a key nor the address book. This shares only code.
#
#   docker build -t sparky-beta-runners runners
#   docker run -e SERVICE=keeper  --env-file runners/.env -v $BOOK:/srv/mainnet.json:ro sparky-beta-runners
#   docker run -e SERVICE=sweeper --env-file runners/.env -v $BOOK:/srv/mainnet.json:ro sparky-beta-runners
#
# ⚠️ The build context is `runners/`, not the repo root — unlike the app's root Dockerfile, these do
# NOT bake the address book. `DeployCompanion.s.sol` writes no book and each mainnet deploy produces
# fresh addresses, so the book is supplied at run time: mount it and point `DEPLOYMENT_PATH` at its
# absolute path. The built-in default is `<cwd>/deployments/<env>.json` — i.e. `/app/deployments/…`
# in this container, where nothing is mounted — so an absolute `DEPLOYMENT_PATH` is REQUIRED, not
# optional. See runners/.env.example and the "Running as a container" section of runners/README.md.
#
# pnpm 9 specifically — a later major rewrites the lockfile and drops the security overrides in it,
# which is a downgrade nobody reviews (same reason as the app image).

FROM node:22-bookworm-slim AS deps
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# --prod: viem is the only runtime dependency. The runners execute TypeScript directly with
# `node --experimental-strip-types`, so nothing here is compiled and tsc/@types are not needed at
# run time. Skipping them keeps the image small without changing what runs.
RUN pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim AS runtime
# ca-certificates: viem opens an HTTPS transport to the RPC provider, and the slim base cannot verify
# the chain without them. tini: PID 1 that forwards SIGTERM to node and reaps it, so a Coolify
# redeploy stops the container promptly instead of waiting out the 10s kill timeout.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY src ./src
COPY docker-entrypoint.sh ./

# Which runner this is. Overridden per Coolify app; the default keeps a bare `docker run` from
# silently doing nothing. Read by both the CMD below and the healthcheck.
ENV SERVICE=keeper

# Where the liveness heartbeats are written and read. /tmp is always present and writable by the
# unprivileged user; health.ts creates the directory on first beat. Override in lockstep with the
# healthcheck if you relocate it.
ENV HEARTBEAT_DIR=/tmp/sparky-beta-runners

# ⚠️ A hot-key process must never run as root. uid 10001 matches the app image's convention.
RUN useradd --system --no-log-init --uid 10001 --home /app runner && chown -R runner:runner /app
USER runner

# ⚠️ No EXPOSE and no port. Liveness is a file each service touches only after a tick that actually
# completed and was not degraded (an out-of-gas or unreachable-RPC runner stops writing it while its
# process stays up) — so the healthcheck reads file AGE, which "is the PID alive" cannot. A missing
# file is not fresh. start-period covers a rocky first tick: the sweeper's default cadence is 300s, so
# a single slow or failed opening round must not trip the check before the second one lands.
HEALTHCHECK --interval=30s --timeout=10s --start-period=360s --retries=3 \
  CMD ["node", "--experimental-strip-types", "src/healthcheck.ts"]

# tini as PID 1. The entrypoint (run via `sh`, so no +x bit needed) materializes the address book from
# DEPLOYMENT_JSON_B64 when set, then `exec`s node so signals reach it through tini. SERVICE picks the
# runner (keeper|sweeper) and also selects which heartbeat the healthcheck reads.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "./docker-entrypoint.sh"]
