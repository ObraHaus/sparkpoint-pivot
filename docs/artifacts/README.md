# Artifacts

Self-contained HTML artifacts for the program (moved here from `docs/orchestration/` on 2026-09-20).

Served locally from this directory:

```bash
pkill -f "http.server 8123" || true
cd docs/artifacts
setsid nohup python3 -m http.server 8123 </dev/null >/tmp/opencode/artifact-server.log 2>&1 &
# LAN: http://192.168.31.232:8123/<file>.html
```

| Artifact | What |
|---|---|
| `vault-program-roadmap.html` | Part 1 — the shipped v4.0.0 wrapper fleet (record). |
| `vault-program-roadmap-part2.html` | Part 2 — the V3 pivot: plan, roles, lifecycle, checklist V.1–V.8, deploy/cancel commands. |
| `vault-topology.html` | One-page live topology explainer (what is live, what a vault is, the two timelock permissions). |
| `vault-page-wireframes.html` | `/vault` redesign — three card-first wireframe options (Spotlight, Leaderboard, Editorial) + the public-vs-admin data contract. Mock only. |
| `token-logos.html` | Token-logo collection for review (embedded art + sources): USDG, ETH/WETH/USDC, the Robinhood Stock Tokens, and the gaps. |
