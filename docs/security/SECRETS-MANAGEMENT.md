# Secrets Management

## Rule zero

A secret is anything that grants access. It belongs in an environment variable or
a secret manager — never in source, never in a build artefact, and **never in a
`VITE_`-prefixed variable**, because Vite inlines those into the public browser
bundle.

## Inventory

Names only. Values are deliberately not reproduced in this document.

### Backend (`backend/.env`, keys declared in `backend/.env.example`)

| Variable | Purpose | Exposure if leaked |
| --- | --- | --- |
| `JWT_SECRET` | signs every API token | **Total** — forge any role, including `super_admin` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | bootstrap super-admin | **Total** |
| `WHATSAPP_MASTER_EMAIL`, `WHATSAPP_MASTER_PASSWORD` | WhatsApp master session | Message relay, agent access |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID` | Cloud API | Send messages as the business |
| `WHATSAPP_VERIFY_TOKEN` | webhook verification | Spoof inbound webhooks |
| `RDS_INSTANCE_IDENTIFIER`, `AWS_REGION` | database location | Reconnaissance |
| `DB_TUNNEL_PGUSER`, `DB_TUNNEL_PGPASSWORD` | credentials for the SSH tunnel to RDS | **Total** — direct production database access |
| `HEAD_AWS_ACCESS_KEY_ID`, `HEAD_AWS_SECRET_ACCESS_KEY` | upstream AWS | AWS account compromise |
| `UPSTREAM_AWS_ACCESS_KEY_ID`, `UPSTREAM_AWS_SECRET_ACCESS_KEY` | upstream AWS | AWS account compromise |
| `LOCAL_DB_ACCESS`, `LOCAL_DB_ACCESS_RULE_TTL_HOURS` | temporary DB ingress | Direct database access |

Database connection values (host, port, user, password) are also environment-only;
confirm they are absent from `.env.example` with real values.

### Client (`client/.env`, gitignored)

| Variable | Status |
| --- | --- |
| `VITE_API_URL`, `VITE_SOCKET_URL` | **Public by design.** URLs, not secrets |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | present commented at `client/.env:2-3`; the anon key is public by design but must still be RLS-restricted |
| `VITE_WHATSAPP_MASTER_EMAIL`, `VITE_WHATSAPP_MASTER_PASSWORD` | **plaintext at `client/.env:23-24`** — SEC-011 |

### GitHub Actions

Both AWS deploy workflows were removed (`deploy.yml`, `deploy-frontend.yml`); deploys are
manual. The secrets below are historical references only.

## Findings

### SEC-011 — a master password is wired into a client build

`deploy-frontend.yml:43-44` passes `VITE_WHATSAPP_MASTER_EMAIL` and
`VITE_WHATSAPP_MASTER_PASSWORD` into the Vite build. Vite inlines `VITE_`
variables into the shipped JavaScript. No source file currently references them,
so the credential is not in today's bundle — but a single
`import.meta.env.VITE_WHATSAPP_MASTER_PASSWORD` publishes an admin password to
every visitor.

**Fix:** move the WhatsApp master authentication entirely server-side and delete
both variables from the workflow and from `client/.env`.

### SEC-001 — a shared password is committed in client source

A shared username/password is committed in
`client/src/components/TicketGate.jsx:5-6` and
`client/src/components/TechnicalTickets.jsx:9-10`, verified present in
`client/dist/assets/index-*.js`.

**Fix:** delete the credential comparison, enforce the role server-side, and
rotate it — it must now be considered public.

### Hardcoded in client source

| Value | Location | Note |
| --- | --- | --- |
| `password: '123456'` | `super-admin/pages/Users.jsx:11,27`, `NGOs.jsx:12,50` | pre-filled default for new accounts (SEC-018) |
| `panCard: 'PAN CARD No : AAJTA4535B'` | `accounts/components/ReceiptTemplate_Ashray.jsx:19`, `ReceiptTemplateAshray.jsx:13` | a real PAN template; treat as personal data |
| phone / email | `hr/components/Letters.jsx:777,799,811,896,909` | real contact details in source |

No live cloud API keys, JWTs, or database passwords were found in `client/src`.
Sample values in `panels/documentation/data/*.js` are clearly labelled fixtures.

## Handling rules

1. **`.env` is never committed.** `client/.gitignore` covers `.env`; confirm
   `backend/.gitignore` does too, and that no `.env` file is tracked
   (`git ls-files | Select-String '\.env$'` should return nothing).
2. **`.env.example` holds names and safe placeholders only.** Review changes to
   it — it is the most likely place for a real value to be committed by mistake.
3. **Never put a secret behind a `VITE_` prefix.** If a browser feature needs a
   credential, the credential belongs on the server.
4. **Separate secrets per environment and per subsystem.** One `JWT_SECRET` for
   every integration means a single leak compromises all of them.
5. **Pin the JWT algorithm** — see [AUTHENTICATION.md](AUTHENTICATION.md).
6. **Restrict database ingress.** `LOCAL_DB_ACCESS` opens TCP 5432 to a CIDR
   range; keep the TTL short and confirm the rule is revoked afterwards.

## Rotation

| Secret | Rotate when | How |
| --- | --- | --- |
| `JWT_SECRET` | any suspected leak | Replace and restart; **all sessions invalidate immediately** — coordinate with users. A staged rotation (accept old + new for one token lifetime) avoids a mass logout |
| Admin / user passwords | on suspicion or staff exit | Force a change on next login; there is no denylist today |
| `SERVER_SSH_KEY` | on host rebuild or staff change | Replace the key pair on the host, update the secret, redeploy |
| WhatsApp / Razorpay / AWS | on suspicion or staff change | Rotate in the provider console, then update the environment and restart |
| `CRM_WHATSAPP_*` | immediately | Delete from the workflow and rotate; they are secret-shaped and client-injected |

## Audit checklist

Run before any release that touches configuration:

```bash
git ls-files | Select-String '\.env$'
git log -p --all -S 'password' -- '*.env*'
Select-String -Path client\.env.example,backend\.env.example -Pattern 'eyJ|sk_live|pk_live|AKIA|ghp_|password\s*=\s*\S'
Select-String -Path client\src\**\*.js* -Pattern 'VITE_.*(SECRET|PASSWORD|KEY|TOKEN)'
```

Any hit in a tracked file is an incident: rotate first, then clean history with
`git filter-repo` and force-push with coordination.
