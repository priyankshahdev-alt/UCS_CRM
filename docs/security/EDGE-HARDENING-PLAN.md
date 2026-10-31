# Edge Hardening — Caddy (production) and nginx (HEAD)

**Status:** Phase 0 complete — real configs read from both hosts
**Severity:** P1 (production); P2 (HEAD)
**Hosts:** prod `13.207.47.116`, HEAD `52.66.211.205`
**Owner:** _(assign)_

---

## Read this first: the docs were describing the wrong server

The existing security documentation says nginx on both hosts. That is **half true**, and
the half that was wrong is the half that serves production.

| | Production `13.207.47.116` | HEAD `52.66.211.205` |
| --- | --- | --- |
| Reverse proxy | **Caddy v2.11.4** (`/usr/bin/caddy`) | **nginx** (`/usr/sbin/nginx`) |
| Config path | `/etc/caddy/Caddyfile` | `/etc/nginx/sites-enabled/` |
| Service | `caddy` — `active`, `enabled` | `nginx` |
| Admin API | `127.0.0.1:2019` | n/a |
| Auto HTTPS | yes, automatic | none (`listen 80` only) |

Consequences of getting this wrong:

- `docs/security/REVERSE-PROXY.md` carries a 182-line **nginx** sample config that has
  never described production. Its `limit_req` zones, `proxy_params`, and `infra/nginx/`
  layout are fiction with respect to the live edge.
- `scripts/sync-head.ps1:78` runs `sudo nginx -s reload`. That is correct for HEAD and
  **wrong for production**. Confirm the production deploy path never relies on it.
- Caddy ships **no security headers at all** in this config, and the API origin leaks
  `X-Powered-By: Express`.

Both boxes run the same Express app, so the findings below are about the edge, not the app.

---

## Phase 0 — Discover (DONE)

- [x] Confirm proxy software on each host
- [x] Read the real production Caddyfile
- [x] Read the real HEAD nginx config
- [x] Confirm `caddy` is `active` and `enabled` (survives reboot)
- [x] Capture live response headers from both origins
- [x] Enumerate the other sites sharing the production Caddyfile

### Live header capture — production, 2026-09-30

`https://api.beingsevak.org/`:

```
HTTP/1.1 200 OK
Server: Caddy
Content-Type: text/html; charset=utf-8
Alt-Svc: h3=":443"; ma=2592000
Vary: Accept-Encoding
```

`https://api.beingsevak.org/api/db/tables`:

```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Server: Caddy
X-Powered-By: Express
Via: 1.1 Caddy
```

Confirmed absent on both: `Strict-Transport-Security`, `Content-Security-Policy`,
`X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`.

Note the API response to `/api/db/tables` is `200` from the internet. That is the
unauthenticated arbitrary-SQL finding, and it is **confirmed exploitable through the
live edge**, not merely inferred from source.

### Other sites sharing the production Caddyfile

One config file serves five domains. Any edit must preserve all five:

| Site | Root |
| --- | --- |
| `api.beingsevak.org`, `13-207-47-116.sslip.io` | `reverse_proxy 127.0.0.1:5000` |
| `aflf.ngo`, `www.aflf.ngo` | `/var/www/aflf` |
| `manncarefoundation.org`, `www.manncarefoundation.org` | `/var/www/mann` |
| `beingsevak.org`, `www.beingsevak.org` | `/var/www/being` |
| `ultimateconsultancy.services`, `www.ultimateconsultancy.services` | `/var/www/ucs` |

**A syntax error in a proposed config takes down every one of these sites.** That is the
single largest operational risk in this document. Every change goes through
`caddy validate` before reload.

---

## Phase 1 — Commit the real configs (DONE)

- [x] Create `infra/caddy/Caddyfile` — verbatim copy of the production config
- [x] Create `infra/nginx/head.conf` — verbatim copy of the HEAD config
- [x] `infra/README.md` — host inventory, why the two proxies differ, apply + rollback procedure
- [x] Do **not** wire either into CI. Committing is for review; applying stays a
      manual, verified step.
- [ ] Optional: add a scheduled `caddy validate` + config-drift check in CI (reads the
      host, changes nothing)

**Why first:** every later phase edits these files. Reviewing a diff beats editing
production by hand over SSH.

---

## Phase 2 — Fix the documentation (DONE)

- [x] Rewrite `docs/security/REVERSE-PROXY.md` for Caddy — the nginx sample is demoted
      to a non-production reference, and the cert section rewritten (Caddy auto-ACME,
      no certbot)
- [x] Correct `SECURITY.md:78` / `P1-E` / `P1-J` / ownership row, `THREAT-MODEL.md:13`,
      `BACKEND.md:5` — all said "nginx on the app host"
- [x] Correct the two stale `FINDINGS.md` lines and `HARDENING-CHECKLIST.md:58`
- [x] Add this plan and `infra/` to the `docs/security/README.md` index
- [x] Verified `scripts/sync-head.ps1:78` (`nginx -s reload`) is **HEAD-only** and not on
      any production path — no bug, no change needed

---

## Phase 3 — Security headers (production)

Caddy makes this small. `header` blocks inherit to sub-paths, so one block per site
covers the HTML and the assets.

**Do this before CSP.** These four are additive and cannot break rendering:

- [ ] `Strict-Transport-Security "max-age=63072000; includeSubDomains"`
- [ ] `X-Content-Type-Options "nosniff"`
- [ ] `X-Frame-Options "DENY"`
- [ ] `Referrer-Policy "strict-origin-when-cross-origin"`
- [ ] `Permissions-Policy "geolocation=(), microphone=(), camera=()"`

Caddy omits `Server` when you set it explicitly:

- [ ] Suppress the version banner (`Server: Caddy` → omit or blank). Cosmetic only.

Then, separately:

- [ ] **Report-only CSP first.** Ship `Content-Security-Policy-Report-Only` with a
      `report-uri`, collect violations for 7+ days, fix what surfaces, then enforce.
      Do **not** skip to enforcement — the HR panels use inline `style` attributes
      extensively, so `style-src` will need `'unsafe-inline'` or a nonce.
- [ ] Expect the `dangerouslySetInnerHTML` sinks in `client/src/panels/hr/components/Letters.jsx`
      to appear in the report. That is the point of the exercise.

**Strip `X-Powered-By: Express`** at the application, not the edge. Caddy does not
remove it by default, and hiding it at the edge while `/api` still reveals it is
false comfort.

### Rollout procedure — production

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%s)   # backup first
# edit
caddy validate --config /etc/caddy/Caddyfile                        # MUST pass
sudo systemctl reload caddy
curl -sI https://api.beingsevak.org | grep -iE 'strict-transport|x-frame|nosniff|referrer'
# if anything is wrong:
sudo cp /etc/caddy/Caddyfile.bak-<ts> /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

- [ ] Back up `Caddyfile` before each change
- [ ] `caddy validate` passes before every reload
- [ ] Reload (`reload`, not `restart`) — zero dropped connections
- [ ] Verify **all five sites** still respond after reload
- [ ] Confirm headers present on the API site

---

## Phase 4 — Body size and upload paths

- [ ] Set a body limit on the API site. HEAD already uses `client_max_body_size 100M`;
      production has no equivalent. Match whatever the largest legitimate letter/PDF
      actually is, and cap it — the process runs with a 640 MB heap
      (`ecosystem.config.cjs:21`) and has a history of 850+ OOM restarts, so an
      unbounded body is a one-request denial of service.
- [ ] Decide `/uploads` on production. `backend/src/index.js:505` serves it as
      `express.static` with **no auth**, and it holds donor paperwork. Either
      authorise it or remove the route.
- [ ] Same decision for `location /uploads/` on HEAD (currently proxied to the app).

---

## Phase 5 — Rate limiting (careful — this is where apps break)

`express-rate-limit` is already a dependency (`backend/package.json:34`), so the
application layer is the safer place to do this.

- [ ] Rate-limit **login routes only** on HEAD (`/api/auth/`, `/api/salary-login`)
- [ ] **Do not** rate-limit `/api/workers/`, `/api/attendance/`, or `/socket.io/`.
      `apps/attendance/lib/pages/attendance_list_page.dart:25` polls every 30 s, and
      every field phone behind one carrier NAT shares a single source IP. A naive limit
      locks staff out mid-shift.
- [ ] On production, prefer the application over the edge — Caddy has no built-in rate
      limiter, and adding one means an external module or a hand-rolled pattern.

---

## Phase 6 — Origin isolation

- [ ] Bind Node to `127.0.0.1` instead of `0.0.0.0`. Currently `0.0.0.0:5000`, with the
      security group as the only thing shielding it. Binding locally removes the
      dependency on that rule being correct forever.
- [ ] Confirm the security group still allows only `80`, `443`, `22` on `sg-0eaff76e14060855f`
- [ ] Close `22` from `0.0.0.0/0` — restrict to the office CIDR

**Sequencing note:** binding Node to loopback must happen together with confirming Caddy
reaches it via `127.0.0.1:5000`. The production Caddyfile already proxies to loopback, so
this is safe — but verify before restarting the app.

---

## Verification

```bash
# Headers present
curl -sI https://api.beingsevak.org | grep -iE 'strict-transport|x-frame|x-content-type|referrer|permissions'

# TLS floor - must fail
curl -sI --tls-max 1.2 https://api.beingsevak.org

# All five sites respond
for h in api.beingsevak.org aflf.ngo manncarefoundation.org beingsevak.org ultimateconsultancy.services; do
  printf "%-36s %s\n" "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://$h)"
done

# Uploads must not be anonymous
curl -sI https://api.beingsevak.org/uploads/          # expect 401/403/404

# Node port must not be reachable from outside
curl -s --max-time 5 http://13.207.47.116:5000/api/db/tables   # expect timeout/refused
```

- [ ] All of the above pass
- [ ] No regression in the other sites

---

## Out of scope here

Blocking `/api/db/*` or `/api/envadmin/*` at the edge looked like cheap containment and
**is not**:

- `client/src/panels/hr/store.jsx:156-168` still calls `/api/db/query` as a live
  fallback, with **no** `Authorization` header. Edge-blocking it breaks the HR NGO
  Salary Report.
- Auth-gating it in code breaks it identically, until that fallback is deleted.

Do the code fix (`SECURITY.md` P0-A), delete the fallback, then consider the edge.

**Also not an edge problem:** the S3 PII incident. That bucket was reachable by raw S3
URL, entirely outside the proxy. Containment is already applied — see
[S3-PII-EXPOSURE-REMEDIATION.md](S3-PII-EXPOSURE-REMEDIATION.md).