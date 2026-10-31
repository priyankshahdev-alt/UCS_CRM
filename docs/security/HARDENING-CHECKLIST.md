# Hardening Checklist

Work through this before a release that touches auth, uploads, CORS, the reverse
proxy, or anything handling personal data. Cross-referenced with
[FINDINGS.md](FINDINGS.md).

## Secrets and configuration

- [ ] No `.env` file is tracked (`git ls-files | Select-String '\.env$'` is empty)
- [ ] `.env.example` files contain no real values
- [ ] No secret-shaped value in a `VITE_` variable, and no source file reads one
- [ ] No new hardcoded credential in client or backend source
- [ ] Database ingress rules are closed or TTL-bounded
- [ ] Secrets differ per environment

## Authentication and authorization

- [ ] Every router mount in `backend/src/index.js:197-277` has an explicit auth gate
- [ ] New endpoints use `authenticateRole` / `authenticate`, not a bespoke check
- [ ] `jwt.verify` pins `algorithms: ['HS256']`
- [ ] Every issued token has a bounded lifetime (SEC-017)
- [ ] 403/401 bodies do not echo required roles (SEC-014)
- [ ] No client-only gate is treated as a control

## Input, SQL and uploads

- [ ] New raw SQL uses `$n` placeholders; dynamic identifiers are allow-listed (SEC-012)
- [ ] Uploads validate MIME **and** extension server-side, with a `multer` size cap
- [ ] Uploaded filenames are regenerated server-side
- [ ] Uploads are served only through an authorising route, never `express.static` (SEC-005)
- [ ] Client-side upload caps account for ~33% base64 expansion (SEC-019)
- [ ] Pagination `LIMIT`/`OFFSET` are coerced and bounded

## Data exposure

- [ ] No PII written to `localStorage` or `sessionStorage` (SEC-008)
- [ ] Aadhaar/PAN/bank values are masked by default
- [ ] Logs contain no tokens, passwords, PII, or raw request bodies
- [ ] Error responses return a code, not a driver or stack trace (SEC-014)
- [ ] Export/report endpoints are restricted to the roles that need them

## Frontend

- [ ] No new `dangerouslySetInnerHTML` or `innerHTML` without sanitisation
- [ ] Interpolated values in generated HTML pass through `esc()` (SEC-002)
- [ ] DOMPurify is a **direct** dependency before it is imported
- [ ] No new internal documentation added to the shipped bundle (SEC-009)
- [ ] `API_BASE` still has a working fallback

## Reverse proxy

- [ ] TLS 1.2+ only; HSTS set with a long max-age
- [ ] CSP, `X-Frame-Options`/`frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` present
- [ ] `client_max_body_size` bounded at the edge
- [ ] Auth routes rate limited more strictly than the rest of the API
- [ ] Node port not reachable from outside the host
- [ ] Edge config committed to the repository, not only on the host
- [ ] Certificate renewal and proxy reload verified (Caddy auto-ACME on prod; `nginx -s reload` on HEAD)

## Verification

```bash
# Headers
curl -sI https://api.beingsevak.org | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer-policy'

# TLS floor
curl -sI --tls-max 1.1 https://api.beingsevak.org    # must fail

# Uploads must not be world readable
curl -sI https://api.beingsevak.org/uploads/          # must 401/403/404

# Auth throttling
# 10 rapid POSTs to /api/auth/login must start returning 429

# Tests
cd backend; npm test        # must be green
cd client;  npm run build   # must succeed
```

## Deploy gate

Both AWS deploy workflows were removed; deploys are manual. Add a hard-failing
HTTP check against whatever host serves the bundle before relying on CI as a
security control.

## Incident response

If a leak is suspected:

1. **Contain first** — rotate the affected secret; revoke sessions; close DB
   ingress.
2. **Preserve evidence** — logs, access records, the affected file or commit.
3. **Assess** — which data, how many records, who had access, for how long.
4. **Notify** — determine whether the 2023 DPDP Act breach-notification duty is
   triggered and involve legal/leadership.
5. **Remediate the source** — fix, then purge history with `git filter-repo`.
6. **Write it up** — add a finding to `FINDINGS.md` so the next audit starts from
   what was learned.

For personal-data breaches, assume notification is required until counsel says
otherwise.
