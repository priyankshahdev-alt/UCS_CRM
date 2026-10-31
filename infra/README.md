# Infrastructure

Reverse-proxy configuration for the CRM stack. **These files are copies of what is
actually running**, captured so changes become reviewable diffs instead of ad-hoc
edits over SSH.

## Hosts and proxies

| | Production | HEAD |
| --- | --- | --- |
| Host | `13.207.47.116` | `52.66.211.205` |
| Proxy | **Caddy v2.11.4** | **nginx** |
| Live config | `/etc/caddy/Caddyfile` | `/etc/nginx/sites-available/ucs-crm` |
| Enabled at | n/a | `/etc/nginx/sites-enabled/ucs-crm` (symlink) |
| Service | `caddy` — `active`, `enabled` | `nginx` |
| Static root | `/var/www/crm` | `/var/www/ucs-crm/dist` |
| API origin | `127.0.0.1:5000` | `127.0.0.1:5000` |
| TLS | automatic (ACME) | none — `listen 80` only |

**The two proxies differ on purpose.** HEAD predates the production migration to Caddy
and still runs the nginx config it was provisioned with. Do not "fix" the mismatch by
rewriting one into the other — migrate deliberately, with a rollback path, or leave it.

## Files

| File | Source | Apply with |
| --- | --- | --- |
| `caddy/Caddyfile` | prod `/etc/caddy/Caddyfile` | `sudo cp` then `caddy validate`, then `systemctl reload caddy` |
| `nginx/head.conf` | HEAD `/etc/nginx/sites-available/ucs-crm` | `sudo cp` then `nginx -t`, then `systemctl reload nginx` |

Both are verbatim captures. No hardening edits yet — see
[`../docs/security/EDGE-HARDENING-PLAN.md`](../docs/security/EDGE-HARDENING-PLAN.md).

## Production serves five domains from one file

`caddy/Caddyfile` is a single file serving five sites. **A syntax error takes all of them
down.** Any edit is a production-wide change.

| Site | Root |
| --- | --- |
| `api.beingsevak.org`, `13-207-47-116.sslip.io` | `reverse_proxy 127.0.0.1:5000` |
| `aflf.ngo`, `www.aflf.ngo` | `/var/www/aflf` |
| `manncarefoundation.org`, `www.manncarefoundation.org` | `/var/www/mann` |
| `beingsevak.org`, `www.beingsevak.org` | `/var/www/being` |
| `ultimateconsultancy.services`, `www.ultimateconsultancy.services` | `/var/www/ucs` |

When editing, verify **all five** respond afterwards.

## Apply procedure — production

```bash
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%s)

# ...edit the local copy in caddy/Caddyfile first, then:
caddy validate --config /etc/caddy/Caddyfile        # MUST pass before reload
sudo systemctl reload caddy                        # reload, not restart

# confirm every site still answers
for h in api.beingsevak.org aflf.ngo \
         manncarefoundation.org beingsevak.org ultimateconsultancy.services; do
  printf "%-36s %s\n" "$h" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://$h)"
done

# roll back
sudo cp /etc/caddy/Caddyfile.bak-<ts> /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

Use `reload`. It is zero-downtime; `restart` drops connections.

## Apply procedure — HEAD

```bash
sudo cp /etc/nginx/sites-available/ucs-crm /etc/nginx/sites-available/ucs-crm.bak-$(date +%s)
sudo cp nginx/head.conf /etc/nginx/sites-available/ucs-crm
sudo nginx -t                                       # MUST pass
sudo systemctl reload nginx
```

HEAD terminates no TLS. Access to it is plain HTTP — see the hardening plan before
treating it as safe.

## Not wired into CI

Deliberately. Auto-deploying a proxy config that fronts a live API and five unrelated
NGO sites is a much larger blast radius than a frontend bundle. Both files are
committed for **review**; applying them stays a manual, verified step.

## Known issues

- No security headers on either host (`EDGE-HARDENING-PLAN.md` Phase 3)
- `X-Powered-By: Express` leaks on the API origin; strip it in `backend/src/index.js`
- HEAD has no TLS; production has no body-size limit
- `0.0.0.0:5000` on both hosts — only the security group prevents direct origin access
- `scripts/sync-head.ps1` reloads nginx; valid for HEAD, wrong for production