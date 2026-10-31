# Reverse Proxy, TLS and Edge Hardening

> **This document was wrong about production.** It originally described nginx on the
> app host. Production actually runs **Caddy v2.11.4**; only the HEAD host runs nginx.
> The nginx sample config further down has therefore never described the live
> production edge. See [infra/README.md](../../infra/README.md) for the captured real
> configs and [EDGE-HARDENING-PLAN.md](EDGE-HARDENING-PLAN.md) for the phased work.

## Current state — audited on the host, 2026-09-30

Both proxies were read directly from the hosts. Configs are now committed.

| | Production `13.207.47.116` | HEAD `52.66.211.205` |
| --- | --- | --- |
| Proxy | **Caddy v2.11.4** | **nginx** |
| Live config | `/etc/caddy/Caddyfile` | `/etc/nginx/sites-available/ucs-crm` |
| Committed copy | `infra/caddy/Caddyfile` | `infra/nginx/head.conf` |
| TLS | automatic ACME | none — `listen 80` only |

The live production config is:

```caddy
api.beingsevak.org, 13-207-47-116.sslip.io {
    reverse_proxy 127.0.0.1:5000
}
```

It serves **five domains** from one file (see `infra/README.md`), so a syntax error
takes down every site on the box. `caddy validate` before every reload.

### Measured gaps

- **Zero security headers.** `curl -sI https://api.beingsevak.org` confirms no HSTS,
  no CSP, no `frame-ancestors`, no `nosniff`, no `Referrer-Policy`, no
  `Permissions-Policy`.
- **`X-Powered-By: Express`** leaks on the API origin. Strip it in `index.js`;
  Caddy does not remove it.
- **`Access-Control-Allow-Origin: *`** on API responses.
- **`GET /api/db/tables` returns `200` from the internet.** The unauthenticated
  arbitrary-SQL finding is confirmed reachable through the live edge.
- **No body-size limit** in production (HEAD does set `client_max_body_size 100M`).
- **Node binds `0.0.0.0:5000`**; only the security group prevents direct origin access.

See `EDGE-HARDENING-PLAN.md` for the phased remediation.

## What the edge must do

| Concern | Requirement |
| --- | --- |
| TLS | TLS 1.2+ only, modern ciphers, HSTS with a long max-age |
| Hiding the origin | The app host must not be directly reachable; the proxy is the only ingress |
| Static hosting | Serve `client/dist` with hashed-asset caching, `index.html` never cached |
| API proxying | Proxy `/api` to the Node process; do not expose the Node port publicly |
| Upload path | Do **not** proxy or serve `/uploads` as static — it must be authorised (SEC-005) |
| Headers | Set CSP, HSTS, frame-ancestors, nosniff, referrer and permissions policy |
| Body size | Bound request bodies at the edge *before* they reach the Node parser |
| Logging | Log status, method, path, upstream status and client IP — never bodies or headers |
| Rate limiting | Coarse edge limit to absorb floods before they reach the app |

## Target Caddy configuration (production)

This is the **proposed** hardened config for `/etc/caddy/Caddyfile`. It is not
applied yet — the live file is still the plain version captured in
`infra/caddy/Caddyfile`. Apply per `infra/README.md`: back up, edit,
`caddy validate`, `systemctl reload caddy`, then verify all five sites.

```caddy
# Security headers. 'header' blocks inherit to sub-paths, so one per site
# covers the HTML and its assets.
#
# Applied first without Content-Security-Policy, because these four are purely
# additive and cannot break rendering. CSP is deliberately absent here - see
# "CSP rollout" below. Do not add it in the same edit.
(common_security_headers) {
	header {
		Strict-Transport-Security "max-age=63072000; includeSubDomains"
		X-Content-Type-Options    "nosniff"
		X-Frame-Options           "DENY"
		Referrer-Policy           "strict-origin-when-cross-origin"
		Permissions-Policy        "geolocation=(), microphone=(), camera=(), payment=()"
		# Caddy ships the 'Server' header; blank it to remove the fingerprint.
		-Server
	}
}

# --- API: proxy to Node ------------------------------------------------
api.beingsevak.org, 13-207-47-116.sslip.io {
	import common_security_headers

	# Bound the body before Node buffers it. Match the largest legitimate
	# letter/PDF upload; the process heap is 640MB with a history of OOM
	# restarts, so this is a one-request DoS control.
	request_body {
		max_size 12MB
	}

	reverse_proxy 127.0.0.1:5000 {
		header_up X-Forwarded-For {remote_host}
		header_up X-Forwarded-Proto {scheme}
		header_up X-Real-IP {remote_host}
	}
}

# --- Other sites sharing this file ------------------------------------
# Unchanged in this proposal. They exist on the same host, so a syntax error
# anywhere above takes them all down. Do not edit them while hardening.
aflf.ngo, www.aflf.ngo {
	root * /var/www/aflf
	encode gzip
	try_files {path} /index.html
	file_server
}

manncarefoundation.org, www.manncarefoundation.org {
	root * /var/www/mann
	encode gzip
	try_files {path} /index.html
	file_server
}

beingsevak.org, www.beingsevak.org {
	root * /var/www/being
	encode gzip
	try_files {path} /index.html
	file_server
}

ultimateconsultancy.services, www.ultimateconsultancy.services {
	root * /var/www/ucs
	encode gzip
	try_files {path} /index.html
	file_server
}
```

### What changed and why

| Change | Reason |
| --- | --- |
| `header` blocks | Caddy omits headers unless asked; there were none. |
| `-Server` | Suppresses the stack fingerprint. Cosmetic, not a control. |
| `request_body.max_size 12MB` | Production had no body limit. Bounds memory before Node sees it. |
| `X-Forwarded-*` | The backend sets `app.set('trust proxy','loopback')` (`index.js:118`), so these must be right or `req.ip` is wrong. Caddy sets them automatically; stated explicitly to match the nginx equivalent. |
| Other four sites | **Untouched.** Included only to show the full file that will be written. |

**No rate limiting here, deliberately.** Caddy has no built-in limiter. `express-rate-limit`
is already a dependency (`backend/package.json:34`), so do it in the app — and never on
`/api/workers/` or `/api/attendance/`, which field phones poll every 30 s behind shared
carrier NAT. See `EDGE-HARDENING-PLAN.md` Phase 5.

**`/uploads` is not handled in this config** on purpose. `backend/src/index.js:505`
serves it as unauthenticated static. Decide in code whether to authorise or remove it —
`EDGE-HARDENING-PLAN.md` Phase 4.

## HEAD host: current nginx config

Captured verbatim in `infra/nginx/head.conf`. As deployed it has **no TLS**
(`listen 80` only), no security headers, and no body-size limit beyond
`client_max_body_size 100M`. That is a P2: HEAD appears to be a staging/HEAD-of-git
box, but it proxies `/api` to a **production** database, so an untls box in front of
production data is worth revisiting rather than dismissing.

## Sample nginx hardening reference (not production)

Retained for the HEAD host and for anyone adding a new nginx front end. **This is not
the production config** — production is Caddy, above. Hostnames below are placeholders.

```nginx
# Rate limit zones. Tune the numbers to real traffic before enforcing.
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=20r/s;
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=12r/m;
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

server {
    listen 80;
    server_name api.beingsevak.org;
    # Redirect everything except the ACME challenge.
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name crm.example.org;

    ssl_certificate     /etc/letsencrypt/live/crm.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.example.org/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_stapling on;
    ssl_stapling_verify on;

    # --- Security headers (SEC-003) ---------------------------------------
    # 'unsafe-inline' for style-src is required by Tailwind v4 and the inline
    # style attributes used across the panels. Tighten to a nonce/hash as a
    # follow-up. No 'unsafe-eval': the Vite production build does not need it.
    # 'wasm-unsafe-eval' is required by the xlsx/jszip report libraries.
    add_header Content-Security-Policy "\
default-src 'self'; \
base-uri 'self'; \
object-src 'none'; \
frame-ancestors 'none'; \
form-action 'self'; \
script-src 'self' 'wasm-unsafe-eval'; \
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
font-src 'self' https://fonts.gstatic.com data:; \
img-src 'self' data: blob:; \
connect-src 'self' wss://api.beingsevak.org; \
frame-src 'self' blob:; \
worker-src 'self' blob:" always;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "DENY" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy        "geolocation=(), microphone=(), camera=(), payment=()" always;
    add_header Cross-Origin-Opener-Policy   "same-origin" always;
    # Remove fingerprints that describe the stack.
    proxy_hide_header X-Powered-By;

    root /var/www/crm;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    client_max_body_size 12m;   # bound before Node buffers (SEC-019)

    # --- Static assets ----------------------------------------------------
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable" always;
        try_files $uri =404;
    }

    # The entry point must never be cached, or clients pin an old bundle.
    location = /index.html {
        add_header Cache-Control "no-store, must-revalidate" always;
    }

    # --- API --------------------------------------------------------------
    location /api/auth/    { limit_req zone=auth_limit burst=5 nodelay; proxy_pass http://127.0.0.1:5000; include /etc/nginx/proxy_params; }
    location /api/workers/  { limit_req zone=auth_limit burst=5 nodelay; proxy_pass http://127.0.0.1:5000; include /etc/nginx/proxy_params; }
    location /api/         { limit_req zone=api_limit  burst=40 nodelay; proxy_pass http://127.0.0.1:5000; include /etc/nginx/proxy_params; }

    # /uploads must NOT be a static alias (SEC-005). Either drop it so the
    # backend decides, or proxy it to an authorising route.
    location /uploads/ { return 404; }

    location / { try_files $uri $uri/ /index.html; }
}
```

`/etc/nginx/proxy_params` should include at least:

```nginx
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Upgrade           $http_upgrade;   # websockets
proxy_set_header Connection        "upgrade";
proxy_read_timeout 120s;
```

`X-Forwarded-For`/`X-Forwarded-Proto` matter: the backend sets
`app.set('trust proxy', 'loopback')` (`backend/src/index.js:116`), so the hop
count must match reality or `req.ip` is wrong — which breaks any rate limiter
or audit log (SEC-015). If the Node process ever binds a non-loopback interface,
firewall it so only nginx can reach it.

## CSP rollout

Ship CSP in report-only mode first, then enforce:

1. `Content-Security-Policy-Report-Only` with `report-uri`/`report-to`, collect
   violations for a week.
2. Fix the violations — expect the three `dangerouslySetInnerHTML` sinks
   (SEC-002, SEC-010) to surface here.
3. Enforce with the policy above.

Do not skip straight to enforcement: the panels use inline `style` attributes
extensively, so `style-src` will need `'unsafe-inline'` or a nonce strategy.

## Certificate handling

Production runs Caddy, which obtains and renews certificates automatically over ACME.
There is no certbot, no renewal timer, and no reload hook to wire up.

- Confirm certificates are being issued and renewed by monitoring the Caddy log and
  expiry, not a timer. Caddy retries on its own; a silent failure is the risk.
- Every hostname in `infra/caddy/Caddyfile` gets a certificate automatically. If one
  ever stops resolving, that site's TLS breaks on its own.
- OCSP stapling is on by default in Caddy. Nothing to configure.
- Monitor expiry regardless — an expired certificate on this host takes every site down,
  and five domains ride on one file.

The HEAD host is the opposite: plain `listen 80`, no TLS at all. It proxies `/api` to a
production database. Whether that is acceptable is a question about what HEAD is *for*;
flagging it rather than deciding it.

## Verification checklist

Run from outside the app network:

```bash
# Security headers now present (this is what returns 200 today with none of them)
curl -sI https://api.beingsevak.org | grep -iE 'strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'

# TLS floor - must fail
curl -sI --tls-max 1.1 https://api.beingsevak.org

# Path traversal - must be 400/404
curl -s https://api.beingsevak.org/uploads/../package.json

# All five sites must still respond after any Caddyfile change
for h in api.beingsevak.org aflf.ngo \
         manncarefoundation.org beingsevak.org ultimateconsultancy.services; do
  printf "%-36s %s\n" "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://$h)"
done

# Node port must not be reachable from outside
curl -s --max-time 5 http://13.207.47.116:5000/api/db/tables   # expect timeout/refused
```

Also confirm `/uploads` no longer serves files anonymously, and that the remaining
five sites are unharmed.
