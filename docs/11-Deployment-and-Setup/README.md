# UCS CRM — Setup, Environment, Deployment & Troubleshooting

> **Document ID:** 11-Deployment-and-Setup/README
> **Status:** Verified (commands from project config) / Unverified steps marked
> **Generated:** 2026-10-13

- [Environment Variable Reference (names & descriptions only)](ENV-REFERENCE.md)
- [Development & Production Deployment](DEPLOYMENT.md)
- [Troubleshooting & Common Errors](../12-Troubleshooting/TROUBLESHOOTING.md)

## Prerequisites

| Tool | Version | Used by |
| --- | --- | --- |
| Node.js | 24.x (backend), >=18 (client) | `backend/package.json`, `client/package.json` |
| npm | matches Node | both |
| PostgreSQL | managed (Supabase / RDS) | backend |
| Redis | optional (used by `ioredis`) | backend |

## Quick Start (Development)

```bash
# Backend
cd backend
npm install
cp .env.example .env          # fill in required values (see ENV-REFERENCE.md)
npm run dev                   # nodemon src/index.js — listens on PORT

# Client (second terminal)
cd client
npm install
cp .env.example .env          # VITE_API_URL, VITE_SOCKET_URL
npm run dev                   # Vite dev server (default 5173)
```

> **Not verified in this build:** whether backing services (PostgreSQL/Redis) are required for a full `npm run dev`; the backend boot runs 27 schema bootstraps that write to the database.

## Build & Test Commands

```bash
cd client && npm run build                    # outputs to client/dist
cd backend && npm test                        # node --test "src/**/*.test.js"
cd client && npm run test:sidebar             # sidebar smoke test
cd backend && npm run security:check          # security static checks
```

## Deployment Architecture Summary

| Environment | Host | Edge | Process | Evidence |
| --- | --- | --- | --- | --- |
| Production | EC2 `13.207.47.116` | Caddy v2.11.4 | PM2 via `backend/ecosystem.config.cjs` | `infra/caddy/Caddyfile` |
| HEAD/dev | EC2 `52.66.211.205` | nginx (`listen 80`) | PM2 `ucs-backend` | `infra/nginx/head.conf`, `scripts/sync-head.ps1` |
| Static PWAs | Vercel | — | — | `.github/workflows/deploy-vercel.yml` |

CI: `deploy.yml` (backend → prod, `npm ci`, `pm2 startOrRestart`, health check `https://api.beingsevak.org/api/health`, auto-rollback). The frontend deploy workflow was removed — `client/dist` is copied to the web root manually.

> Endpoint hostnames above are read from repo config (`infra/`), not from production secrets.