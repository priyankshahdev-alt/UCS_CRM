# UCS CRM — Security Standard, Audit and Remediation Plan

**Status:** source of truth for the security posture of UCS CRM.
**Scope:** `client/` SPA, `backend/` API, CI/CD, and the reverse proxy in front of
both. `apps/`, `whatsapp-crm/`, `metro/` and `others/*` are **not assessed** here —
see [§10](#10-known-unassessed-surface).
**Reviewed:** 2026-09-30 against `master` at commit `0ab8562a`.
**Branch:** `security/hardening-2026-09`.

The per-area deep dives remain in this folder as reference:
[THREAT-MODEL.md](THREAT-MODEL.md), [AUTHENTICATION.md](AUTHENTICATION.md),
[FRONTEND.md](FRONTEND.md), [BACKEND.md](BACKEND.md),
[REVERSE-PROXY.md](REVERSE-PROXY.md), [DATA-PROTECTION.md](DATA-PROTECTION.md),
[SECRETS-MANAGEMENT.md](SECRETS-MANAGEMENT.md), [FINDINGS.md](FINDINGS.md),
[HARDENING-CHECKLIST.md](HARDENING-CHECKLIST.md).

---

## Contents

1. [Purpose, scope and legal basis](#1-purpose-scope-and-legal-basis)
2. [System and asset map](#2-system-and-asset-map)
3. [The standard — what UCS CRM must satisfy](#3-the-standard--what-ucs-crm-must-satisfy)
4. [Gap analysis — where we are today](#4-gap-analysis--where-we-are-today)
5. [Remediation backlog P0 → P3](#5-remediation-backlog-p0--p3)
6. [Verification gates](#6-verification-gates)
7. [Secret rotation runbook](#7-secret-rotation-runbook)
8. [Incident response](#8-incident-response)
9. [Governance](#9-governance)
10. [Known unassessed surface](#10-known-unassessed-surface)

---

## 1. Purpose, scope and legal basis

### Why this document exists

The ten files in `docs/security/` were written against commit `4ef33a6b` and
describe a system with a soft perimeter and an over-trusted client. That remains
true. However, an audit against the current `master` (`0ab8562a`) found a
**second, more severe class of problem that none of those files mentions**:

- an **unauthenticated arbitrary-SQL endpoint** on the public API,
- an **unauthenticated tenant-provisioning** endpoint that creates cloud IAM
  users, S3 buckets and Postgres roles,
- an admin surface that **fails open** when its key is unset and will read and
  write every project's `.env`,
- an **unverified webhook** feeding the AI reply pipeline,
- and **live production credentials committed to git** — cloud tokens, database
  superuser passwords, an AWS access key, and the super-admin password.

Those are not hardening gaps. They are active exposures, and they rank above
every item in `FINDINGS.md`. This document folds them in and defines the
standard the system is expected to meet.

### Applicable law

UCS CRM processes Aadhaar, PAN, bank account and IFSC data, donor records
including UPI transaction IDs, salary, loans and biometric attendance. In India
this places the organisation under the **Digital Personal Data Protection Act,
2023**, which requires a lawful basis, purpose limitation, data minimisation,
reasonable security safeguards, and breach notification. Aadhaar-specific
handling expectations apply on top, so **Aadhaar is the most restricted field in
the system**.

Assume breach notification is required until counsel says otherwise.

---

## 2. System and asset map

### Shape

```
 Browsers (client/ SPA, plus 9 other SPAs and 6 mobile apps)
        |  HTTPS
        v
 Reverse proxy  (Caddy on the prod host — config now in version control, infra/)
        |
        +---> /            static SPA bundles          (unauthenticated)
        |
        +---> /api/*       backend (Express 4 + PM2)   (JWT required)
        |
        v
 PostgreSQL on RDS (workers, donors, beneficiaries, leads, worker_loans, ...)
        ^
        |  credentials from environment only
 AWS (RDS backups, WhatsApp Cloud API, Razorpay, Lambda pg_dump)
```

There is no VPN, no IP allow-list at the proxy, and no WAF. Everything above the
database line is reachable from the public internet.

### Critical trust boundary

**The browser is fully attacker-controlled** — `localStorage`, the `ucs_user`
object, and all DOM content. Client-side role checks are rendering sugar, not
controls. The only enforcement point is `authenticateRole` / `authenticate` in
`backend/src/middleware/authMiddleware.js`.

`client/src/components/chat/chatIdentity.js:9-11` documents this correctly and
that comment should be treated as binding policy.

### Assets, by damage on disclosure

| Asset | Sensitivity | Notes |
| --- | --- | --- |
| Aadhaar, PAN, bank account/IFSC, salary | **Restricted** — DPDP personal data | Readable by HR and super-admin; several report/export paths |
| Donor records incl. PAN, UPI IDs, addresses | **Restricted** | Exported to spreadsheets, persisted in browser storage |
| `JWT_SECRET`, WhatsApp/Razorpay/AWS credentials | **Secret** | Full compromise. **Currently in git** — P0-D |
| Impersonation / work-as tokens | **Secret** | Yield super-admin authority |
| Salary, loans, attendance, incentives | Confidential | Business and personal impact |
| Lead and donor pipeline | Confidential | Competitive value |
| Source code, this document set | Internal | Reconnaissance value; currently readable by every role |
| ~100 MB of committed donor datasets | **Restricted** | `backend/scripts/output/*.json`, donor `.xlsx` files |

### Actors

| Actor | Capability assumed |
| --- | --- |
| Anonymous internet user | Reaches the proxy and the API with no token. **Currently has arbitrary-SQL and env-read/write.** |
| Compromised low-privilege account | Has a valid `worker`/`fro`/telecaller token — assumed **likely** |
| Malicious insider (HR/accounts) | Legitimate restricted-data access, abuses it |
| Opportunistic attacker | Credential stuffing, XSS payloads, dependency CVEs |

---

## 3. The standard — what UCS CRM must satisfy

Each requirement is written so it can be tested. `GAP` in
[§4](#4-gap-analysis--where-we-are-today) shows current state.

### 3.1 Authentication and session management

| ID | Requirement |
| --- | --- |
| SEC-REQ-01 | Every route that reads or writes data requires a verified token, except an explicit allow-list of health and auth endpoints. A router mounted with no middleware is a defect. |
| SEC-REQ-02 | Every route additionally declares the roles permitted. "Any valid token" is only acceptable for data with no role restriction. |
| SEC-REQ-03 | `jwt.verify` is always called with an explicit `algorithms: ['HS256']` allow-list. No `alg: none`. |
| SEC-REQ-04 | Every issued token has a **bounded lifetime**. Target: 15 min access + refresh. Absolute maximum 24 h. No token may be issued without `exp`. |
| SEC-REQ-05 | Tokens are stored in an `httpOnly; Secure; SameSite=Strict` cookie. The browser never reads the token; the backend is the only reader. |
| SEC-REQ-06 | Role decisions are made **only** from the verified token, never from client storage. `ProtectedRoute` is a UX affordance. |
| SEC-REQ-07 | Impersonation does not leave a privileged token in any client-reachable store. The super-admin token exists server-side only for the duration of the session. |
| SEC-REQ-08 | Logout invalidates the session server-side (`jti` denylist or refresh-token rotation). A token captured before logout stops working. |
| SEC-REQ-09 | Every authentication endpoint is rate limited per IP **and** per identifier, with lockout or delay after repeated failure. |
| SEC-REQ-10 | Passwords are hashed with bcrypt at cost ≥ 12, uniformly across **every** login path. No plaintext environment comparison for any account. |
| SEC-REQ-11 | No default or pre-filled password. New accounts get a forced password change on first login. Minimum length 12. |
| SEC-REQ-12 | Error responses return a stable code, never a role list, a driver message, or a route-existence signal. |

### 3.2 Authorization and data access

| ID | Requirement |
| --- | --- |
| SEC-REQ-13 | Administrative surfaces (arbitrary SQL, env management, tenant provisioning, user impersonation, record deletion) are gated on an explicit privileged role, never on "any token" and never on a shared secret. |
| SEC-REQ-14 | Any gate that depends on a key **fails closed**. An unset key must deny, log loudly, and page. |
| SEC-REQ-15 | Object-level authorization is enforced per record owner/department on every PII read, not only at the route level. |
| SEC-REQ-16 | Destructive operations (delete, bulk delete, drop) require a privileged role and are audit-logged with actor, target and row count. |
| SEC-REQ-17 | No internal engineering documentation, schema description, or API reference ships in the production bundle. |
| SEC-REQ-18 | Database ingress is short-lived, CIDR-restricted, TTL-bounded, and verified revoked. |

### 3.3 Input, SQL and uploads

| ID | Requirement |
| --- | --- |
| SEC-REQ-19 | All SQL uses `$n` placeholders for values. Dynamic identifiers (`ORDER BY` columns, table names) are validated against an allow-list. A lint rule rejects `_pool.query` with `${` in the template. |
| SEC-REQ-20 | No endpoint accepts caller-supplied SQL, DDL, or an identifier string that reaches the query text. |
| SEC-REQ-21 | Every request body is schema-validated server-side before use. Unknown fields are rejected on high-value endpoints. |
| SEC-REQ-22 | Uploads are validated server-side on **MIME type and extension** (the client `accept=` attribute is a hint only), capped in size by the server, and given a server-generated filename. |
| SEC-REQ-23 | Uploaded files are served **only** through an authorising controller that checks ownership. Never `express.static`. Stored outside the web root. |
| SEC-REQ-24 | Request bodies are bounded at the edge *and* by the parser. Client-side caps account for ~33% base64 expansion. |
| SEC-REQ-25 | Webhooks verify their signature against the **raw** body, in constant time, with a replay window. |
| SEC-REQ-26 | Pagination `LIMIT`/`OFFSET` are coerced and bounded. |

### 3.4 Browser and client

| ID | Requirement |
| --- | --- |
| SEC-REQ-27 | No Aadhaar, PAN, bank detail, salary, or session token is written to `localStorage` or `sessionStorage`. PII lives in memory for the life of the request. |
| SEC-REQ-28 | Every HTML injection point is sanitised with DOMPurify using an allow-list. A lint rule bans `dangerouslySetInnerHTML`, `innerHTML =` and `document.write` outside an allow-list. |
| SEC-REQ-29 | Values interpolated into generated HTML pass through an `esc()` that covers `& < > " '`. |
| SEC-REQ-30 | No credential, shared password, or access code is compared in client code. A gate that grants access is enforced server-side. |
| SEC-REQ-31 | A Content-Security-Policy is set and enforced, with `frame-ancestors 'none'`. It is the compensating control for any XSS that survives SEC-REQ-28. |
| SEC-REQ-32 | One API client only. No hand-rolled duplicate with divergent token or 401 handling. |
| SEC-REQ-33 | `API_BASE` always has a working fallback, and a misconfigured build fails loudly. |
| SEC-REQ-34 | Files with restrictive extensions (`spreadsheet`, `docx`) are parsed with a library that is not known-vulnerable, and the parsed result is treated as untrusted input. |

### 3.5 Secrets management

| ID | Requirement |
| --- | --- |
| SEC-REQ-35 | A secret lives in an environment variable or a secret manager. Never in source, never in a build artefact, never in git history. |
| SEC-REQ-36 | **Never** behind a `VITE_` prefix. Vite inlines those into the public bundle. |
| SEC-REQ-37 | `.env.example` holds names and placeholders only, and is reviewed on every change. |
| SEC-REQ-38 | Every package directory ignores `.env`, `.env.*` locally. A standalone clone must not expose secrets. |
| SEC-REQ-39 | Secrets differ per environment and per subsystem. One `JWT_SECRET` for all integrations means a single leak compromises all of them. |
| SEC-REQ-40 | CI fails the build if a secret-shaped value appears in a tracked file, or if a `VITE_` variable with a secret-sounding name is referenced in `client/src`. |
| SEC-REQ-41 | A committed credential is treated as public and rotated, even after history is cleaned. |

### 3.6 Edge, TLS and headers

| ID | Requirement |
| --- | --- |
| SEC-REQ-42 | TLS 1.2+ only, modern ciphers, HSTS with `max-age ≥ 63072000`, `includeSubDomains`, `preload`. |
| SEC-REQ-43 | CSP, `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` all set. |
| SEC-REQ-44 | The app host is not directly reachable; the proxy is the only ingress. The Node port is not exposed. |
| SEC-REQ-45 | `client_max_body_size` bounded at the edge before the Node parser buffers. |
| SEC-REQ-46 | Auth routes rate limited at the edge more strictly than the rest of the API. |
| SEC-REQ-47 | The edge configuration is **committed to the repository** and reviewed like code. A security control that is unversioned is not a control. |

### 3.7 Data protection

| ID | Requirement |
| --- | --- |
| SEC-REQ-48 | Aadhaar, PAN and bank columns are masked by default; reveal is gated by a server-checked permission. |
| SEC-REQ-49 | A written retention schedule exists and is enforced by a deletion pass. |
| SEC-REQ-50 | Backups are encrypted at rest and in transit, **restore-tested on a schedule**, access-limited and logged. A backup that has never been restored is not a backup. |
| SEC-REQ-51 | Logs contain no tokens, passwords, `Authorization` headers, Aadhaar/PAN values, salary figures, or raw request bodies. |
| SEC-REQ-52 | Real personal data never enters the repository — including in fixtures, sample payloads, and exported datasets. |

### 3.8 Supply chain and CI

| ID | Requirement |
| --- | --- |
| SEC-REQ-53 | Every third-party action is pinned to a commit SHA, not a tag. |
| SEC-REQ-54 | Every workflow declares a minimal `permissions:` block. |
| SEC-REQ-55 | No workflow interpolates untrusted input directly into a shell command. Pass via `env:`. |
| SEC-REQ-56 | No remote binary is installed on a production host without checksum or signature verification. |
| SEC-REQ-57 | A post-deploy check that detects failure **fails the job**. A warning does not. |
| SEC-REQ-58 | A secret scanner and dependency audit run in CI. |
| SEC-REQ-59 | The front end has a lint step in CI, and a lint rule for every dangerous-sink and dangerous-SQL pattern. |

---

## 4. Gap analysis — where we are today

### 4.1 Summary

| Area | State |
| --- | --- |
| Route-level authorization | **Poor.** ~80 router mounts, several with no auth; `authenticate`-only on sensitive routers; inline admin routes in `index.js` with no gate |
| Administrative surfaces | **Critical.** Arbitrary SQL, env read/write, tenant provisioning all reachable unauthenticated |
| Credentials in git | **Critical.** Cloud tokens, DB superuser password, AWS key, super-admin password |
| Token handling | **Poor.** 22 `jwt.sign` sites, 4 emit 100-year tokens, 9 can emit no `exp`; no revocation; no `algorithms` pin; `localStorage` |
| Login protection | **Absent.** 9 login endpoints, zero rate limiting, no lockout |
| Password storage | **Mixed.** bcrypt cost 10 everywhere, but 4 plaintext environment comparisons and a pgcrypto path |
| SQL safety | **Mostly good, badly exposed.** 323 query sites, only 15 interpolate `${}`, and the dangerous ones are the unauthenticated ones |
| Uploads | **Poor.** `/uploads` served via `express.static`; 9 of 18 multer instances lack a `fileFilter` |
| Browser storage | **Poor.** Donor PAN/UPI/Aadhaar-adjacent data and session tokens in `localStorage` |
| XSS | **Poor.** 3 `dangerouslySetInnerHTML`, 6 `innerHTML =`, 7 `document.write`; no DOMPurify import anywhere |
| Security headers | **None.** Zero CSP, zero HSTS, zero frame-ancestors, no `helmet` dependency |
| Webhook verification | **Absent** on the WhatsApp webhook |
| Logging hygiene | **Poor.** ~854 inline `err.message` returns to clients; a correct sanitiser exists with zero importers |
| CI supply chain | **Poor.** 20 unpinned actions, 4 of 5 workflows with no `permissions:`, unverified RPM installed as root each deploy |
| Secret scanning | **None.** No scanner, no lint, no pre-commit hook, no dependabot, no CODEOWNERS |
| Tests | **9 backend unit tests, 0 auth/route/SQL/upload tests. 0 client tests** (one ad-hoc smoke script) |

### 4.2 Requirement gaps

| Req | Gap | Evidence |
| --- | --- | --- |
| 01, 02 | Unauthenticated admin routes: `GET /api/db/tables`, `GET /api/db/table/:table`, `POST /api/db/query`, `POST /api/db/drop-table`, `POST /api/db/rows/delete`, `GET /api/db/capacity` | `index.js:522,538,658,695,708,740` |
| 01, 02 | Unauthenticated `POST /api/customer/provision`, `GET /api/customer/list` | `index.js:750,761` |
| 01, 02 | 6 unauthenticated beneficiary PII GETs | `beneficiaryRoutes.js:87,108,129,139,149,170` |
| 01, 02 | `authenticate`-only: `/api/developer-tickets` (list, approve, reject, resolve, bulk), `/api/ocr`, `/api/whatsapp-crm` data, `/api/sim-cards`, `/api/sim-inventory`, `/api/reminders`, `/api/beneficiaries/import` | `developerTicketRoutes.js:11,25-27` |
| 02, 16 | `DELETE /api/temp-cleanup/force/:id` hard-deletes a worker plus attendance, leaves and loans — any role | `tempCleanupRoutes.js:7,27-33` |
| 03 | 9 `jwt.verify` sites, none pins `algorithms` | `authMiddleware.js:61,77,111,128`, `socket.js:57` |
| 04 | 4× 100-year tokens; 9 sites can issue a token with **no `exp`** | `whatsappCrmAuthController.js:6,70,81`; `froWhatsAppAuthController.js:75,122-126`; `config/db.js:1229-1233`; `authController.js:223-224,273,292,305,323,342,372,398,429` |
| 05, 07 | Token in `localStorage`; **pre-impersonation super-admin token** in `localStorage` | `client/src/api/auth.js:5-8,152-153` |
| 06 | Role read from `localStorage` drives every guard; 2 routes open to all roles via `role={['*']}` (`/wa/*`, `/docs/*`) | `client/src/store.jsx:58-59`; `client/src/App.jsx:53-63,200,206` |
| 08 | No `jti`, no denylist, no `token_version`. Logout only writes `logged_out_at` | `authController.js:178` |
| 09 | 9 login endpoints, zero rate limiting, no lockout. `unifiedLogin` tries 9 credential sources — a 9-way oracle | `authRoutes.js:7-15`; `authController.js:211` |
| 10 | bcrypt cost 10 (below the ≥12 bar) and 4 plaintext env comparisons; pgcrypto `crypt()` path | `authController.js:20-38,51-63,288-304`; `config/db.js:1218`; 12 `genSalt(10)` sites |
| 11 | `password: '123456'` pre-filled in 4 places | `super-admin/pages/Users.jsx:11,27`; `NGOs.jsx:12,50` |
| 12 | 403 echoes required roles; `routeMissing` derived from 404 content-type; raw `err.message` surfaced | `authMiddleware.js:63`; `client/src/api/auth.js:56-83`; ~854 sites in 82 files |
| 13, 14 | `/api/envadmin` **fails open** when `ENV_ADMIN_KEY` unset; key also accepted via `?key=`; non-constant-time compare | `envAdminRoutes.js:31-46` |
| 15 | No per-record ownership check on PII reads; Aadhaar rendered unmasked | `beneficiaries/pages/AllBeneficiaries.jsx:159,185`; `DonorDetailModal.jsx:85-86` |
| 17 | `/docs/*` open to all roles; bundle contains schema, `aadhaar_number`, JWT verification flow | `client/src/App.jsx:205-209`; `panels/documentation/data/*.js` |
| 19, 20 | 15 of 323 query sites interpolate `${}`; the worst are the unauthenticated ones | `customerProvision.js:118-128`; `index.js:700,731-732`; `config/db.js:827` |
| 21 | No schema-validation library in the backend (`zod` is client-only) | `backend/package.json` |
| 22 | 9 of 18 multer instances lack a `fileFilter`; `originalname` unsanitised into an S3 key | `froWhatsAppService.js:743` and 8 others |
| 23 | `/uploads` mounted before auth-aware routes with no middleware | `index.js:501` |
| 24 | 10 MB parser cap; 7 MB client audio cap becomes ~9.4 MB base64 | `index.js:123`; `LeadAudit.jsx:122`; `usePasteImage.js:38-47` |
| 25 | WhatsApp webhook has **no signature verification** | `webhookRoutes.js:40` |
| 27 | Donor name/address/**PAN**/UPI/bank/mobile in `localStorage`; donor PAN/UPI/DOB/screenshot per donor; WhatsApp agent tokens; attendance PIN | `accounts/pages/Dashboard.jsx:207-225`; `fro/pages/MyDonors.jsx:757-764`; `fro/pages/WhatsAppChat.jsx:76-83`; `super-admin/pages/AdminAttendance.jsx:53` |
| 28, 29 | 3 `dangerouslySetInnerHTML`, 6 `innerHTML =`, 7 `document.write`; `esc()` exists but misses `"` and `'` and is applied to few fields; **DOMPurify never imported** | `Certificates.jsx:79,1316`; `Letters.jsx:1043,1303`; `Letters.jsx:88` |
| 30 | Shared username/password compared in client, present in the shipped bundle | `TicketGate.jsx:4-8,32`; `TechnicalTickets.jsx:8-12,190` |
| 31, 42, 43 | Zero security headers anywhere. No `helmet` dependency. `origin:'*'` in both `index.js` and `socket.js` | repo-wide search: 0 hits |
| 32, 33 | 3 divergent API clients; `apiBase.js` has no fallback | `metropad/services/api.js:3,19-22`; `bill-reminder/api.js:25-39`; `lib/apiBase.js:1-2` |
| 34 | `xlsx@^0.18.5` (below the 0.20.x security line) parses spreadsheets on 6 import routes | `backend/package.json` |
| 35, 41 | Live credentials committed: 4 Meta WhatsApp tokens, RDS superuser password (5+ DSNs), AWS access key, `SCRAPER_DEVICE_KEY`, real `ADMIN_*` and `WHATSAPP_MASTER_*` | `others/imp files/privacy/whatsapp.txt:3,11,22,26`; `others/imp files/docs/BACKUP_DISASTER_RECOVERY.md:381`; `apps/scrapper/lib/api_config.dart:2`; `backend/scripts/*` |
| 36 | CI injects `VITE_WHATSAPP_MASTER_EMAIL`/`PASSWORD` into the client build; the same values sit uncommented in `client/.env:23-24`. A second, separate leak: `whatsapp-crm/.../lib/supabase.ts:4` reads a `VITE_` key | `deploy-frontend.yml:43-44`; `whatsapp-crm/src/panels/whatsapp-crm/lib/supabase.ts:4` |
| 38 | `backend/.gitignore` did **not** ignore `.env` — only the repo-root one did, so a standalone `backend/` clone exposed 65 keys. **Fixed** on this branch. | `backend/.gitignore` |
| 42, 44, 45, 46, 47 | No proxy config, no Dockerfile, no IaC, no `add_header` in any tracked file. Headers are configured only on the host, unversioned | repo-wide search: 0 hits |
| 51 | Client `console.error`s API failures; `sanitizeError` exists with zero importers | `hr/components/Letters.jsx:1009,1023`; `backend/src/utils/errors.js` |
| 52 | ~100 MB of committed donor PII datasets and 2 donor `.xlsx` files; a Meta token stored client-reachable in Supabase `tenants.settings` | `backend/scripts/output/*.json`; `backend/docs/*.xlsx` |
| 53, 54, 55, 56 | 20 unpinned actions; 4 of 5 workflows lack `permissions:`; `${{ inputs.worker }}` interpolated into shell; unverified RPM installed as root each deploy | `.github/workflows/*`; `inspect-fro-timer.yml:48`; `install-libreoffice-al2023.sh:35-40` |
| 57 | Post-deploy curl only warns; job stays green on a 500/404/000 | `deploy-frontend.yml:102-109` |
| 58, 59 | No scanner, no `npm audit` in CI, no lint config in either package, no dependabot, no CODEOWNERS, no `SECURITY.md`, no pre-commit hook | repo-wide |
| 49, 50 | Retention policy not implemented; restore test exists monthly but SNS notify silently no-ops on an undefined `env` reference | `backup-restore-test.yml:127-128` |
| 48 | Aadhaar/PAN unmasked in list and modal views; bank printed in worker reports | `AllBeneficiaries.jsx:159,185`; `Workers.jsx:332,366` |

### 4.3 Corrections to the existing reference documents

Three claims in the reference set are stale as of `0ab8562a` and have been
corrected in place:

1. **`wrk` no longer holds Aadhaar.** `hr/components/Workers.jsx:14-16` now
   persists UI state only (search, page, filters). The persistence *pattern*
   remains, but the Aadhaar/bank claim for that key is no longer true.
2. **`receipt_template_settings` holds no donor PII.** It stores
   receipt-design choices only (`TemplateSettings.jsx:41,48`).
3. **Two additional leaks were not listed:** donor PAN/UPI/DOB/screenshot per
   donor (`fro/pages/MyDonors.jsx:757-764`) and an attendance PIN
   (`super-admin/pages/AdminAttendance.jsx:53`).

---

## 5. Remediation backlog

Severity reflects impact against the threat model, where compromise of one
low-privilege authenticated account is assumed **likely** and initial access is
always available. Effort is engineering time for one developer.

### P0 — active exposure, fix first

| ID | Finding | Evidence | Fix | Verify | Effort |
| --- | --- | --- | --- | --- | --- |
| **P0-A** | **Unauthenticated arbitrary SQL on the public API.** `POST /api/db/query` runs caller SQL in a transaction (DDL/DML). Companion routes expose table listing, row read, `DROP TABLE`, row delete, capacity. `localDbAccess` always calls `next()`, so it is no mitigation. Errors leak Postgres `code` and `hint`. | `index.js:522,538,658,695,708,740`; `localDbAccess.js:540-544` | Move behind `authenticateRole('super_admin')`, or delete from production. Stop returning `hint`/`code`. Add a `requireAdminKey` for break-glass use. | Unauthenticated `curl` gets 401/403. `SELECT` of donor PII returns 403. | 0.5 d |
| **P0-B** | **Unauthenticated tenant provisioning.** `POST /api/customer/provision` creates IAM users, S3 buckets, Postgres roles and databases. `role`/`dbPassword` are interpolated into a `$$`-quoted DDL block, so a `$$` in either value breaks out. | `index.js:750,761`; `customerProvision.js:118-128` | Gate on `super_admin`. Replace the `$$` block with parameterised `CREATE ROLE ... PASSWORD` where possible, or strip `$$`. | Unauthenticated call returns 403. | 0.5 d |
| **P0-C** | **`/api/envadmin` fails open.** When `ENV_ADMIN_KEY` is unset every endpoint is open; `GET /api/envadmin/all` dumps the raw `.env` of every sibling project and `POST .../env` **writes** to them. `restart` shells `pkill`/`pm2 restart`. Key also accepted via `?key=`, non-constant-time compare. | `envAdminRoutes.js:31-46` | **Fail closed**: unset key ⇒ `503` + loud log. Accept key only in a header. Use `crypto.timingSafeEqual`. Verify the key is set on the production host. | With the var unset, requests return 503. | 0.5 d |
| **P0-D** | **Live production credentials committed to git.** 4 Meta WhatsApp Cloud API tokens, the RDS superuser password (5+ DSNs), an AWS access key, `SCRAPER_DEVICE_KEY` in a shipped APK, and the real super-admin + WhatsApp master passwords in a **tracked** `.env.example`. | `others/imp files/privacy/whatsapp.txt:3,11,22,26`; `others/imp files/docs/BACKUP_DISASTER_RECOVERY.md:381`; 5 `backend/scripts/*` DSNs; `apps/scrapper/lib/api_config.dart:2`; `backend/.env.example` | **See [§7](#7-secret-rotation-runbook).** Rotate everything, then purge history. Values are not reproduced in this document. **In-repo containment done** (below); **rotation and history purge still outstanding** — both need a human. | No tracked file matches the scanner in [§6](#6-verification-gates). | 1 d + rotation downtime |
| **P0-E** | **Unverified WhatsApp webhook** feeding the AI reply pipeline. No signature check, so anyone who learns the URL can inject inbound messages. | `webhookRoutes.js:40` | Verify the Meta signature against `req.rawBody` (already captured at `index.js:127`) in constant time, with a replay window. | A forged payload is rejected with 401. | 0.5 d |
| **P0-F** | **9 unthrottled login endpoints; no-expiry tokens; 9-way credential oracle.** `/worker/login` and 8 sibling paths issue JWTs with **no `exp`**. `unifiedLogin` tries 9 credential sources sequentially, with no throttle, no lockout, no failure delay. Logout cannot invalidate anything. | `authRoutes.js:7-15`; `authController.js:211,223-224,273,292,305,323,342,372,398,429`; `authController.js:178` | Add an IP+identifier limiter (5/15 min) to every auth route. Bound **every** `expiresIn`. Add a `jti` denylist. Replace plaintext env comparisons with bcrypt hashes. | 10 rapid logins return 429. Every token has an `exp`. | 1.5 d |
| **P0-G** | **6 unauthenticated beneficiary PII GETs** returning Aadhaar, bank and contact data to any caller. | `beneficiaryRoutes.js:87,108,129,139,149,170` | Add `authenticate` + role gate to each. | Anonymous request returns 401. | 0.5 d |
| **P0-H** | **`DELETE /api/temp-cleanup/force/:id` hard-deletes a worker and their attendance, leaves and loans** — available to any valid token. | `tempCleanupRoutes.js:7,27-33` | Restrict to `super_admin`; audit-log actor, target, and deleted row counts. | A `worker` token gets 403. | 0.5 d |

### P1 — high, authenticated attacker or stored XSS

| ID | Finding | Evidence | Fix | Effort |
| --- | --- | --- | --- | --- |
| P1-A | `/uploads` served via `express.static` with **no auth**. Donor paperwork, bank statements, payment screenshots world-readable by path. | `index.js:501` | Move behind `authenticate` with per-owner checks, or store outside the web root and stream through an authorising controller. Audit the directory for historic confidential files first. | 1 d |
| P1-B | **Stored XSS against HR administrators.** Worker/NGO names interpolated raw into letter HTML, injected via `dangerouslySetInnerHTML` and again via `el.innerHTML` before `html2canvas`. A worker controls their own display name. | `Letters.jsx:88,431,484,566,794,…`, sinks `:1043,1303` | Apply a complete `esc()` (including `"` and `'`) to every field, or render as React elements. Ban the sinks via lint. | 1 d |
| P1-C | Unsanitised `mammoth` DOCX→HTML into `dangerouslySetInnerHTML`. DOMPurify is in the tree transitively but **never imported**. | `Certificates.jsx:55,79,436,1316` | Add `dompurify` as a direct dependency; sanitise with an allow-list at both sinks. | 0.5 d |
| P1-D | Shared username/password gates technical tickets in client code and is in the shipped bundle; the server only requires `authenticate`, so **any** token reaches list, bulk-update and approve. | `TicketGate.jsx:4-8,32`; `TechnicalTickets.jsx:8-12,190`; `developerTicketRoutes.js:11,25-27` | Delete the credential comparison. Gate routes on `authenticateRole('super_admin','developer')`. Rotate the credential — it is public. | 0.5 d |
| P1-E | **No security response headers anywhere.** No CSP, HSTS, frame-ancestors, nosniff, referrer or permissions policy. No `helmet` dependency. Confirmed absent on live production responses 2026-09-30. | `curl -sI https://api.beingsevak.org` | See [EDGE-HARDENING-PLAN.md](EDGE-HARDENING-PLAN.md) Phase 3 — Caddy `header` blocks; strip `X-Powered-By` in `index.js`. | 1 d |
| P1-F | **Wildcard CORS** in Express and in socket.io, with `x-admin-key` in `allowedHeaders`. | `index.js:118-128`; `socket.js:46-49` | Explicit origin allow-list from the environment; drop `x-admin-key`. Never combine wildcard with credentials. | 0.5 d |
| P1-G | JWT + **pre-impersonation super-admin token** in `localStorage`; role read from `localStorage` drives every guard. | `api/auth.js:5-8,152-153`; `store.jsx:58-59`; `App.jsx:53-63` | Move to `httpOnly; Secure; SameSite=Strict` cookie — **must land with P1-F**. Make role decisions only from the verified token. | 2 d |
| P1-H | Donor PAN, UPI, address, DOB, screenshot, bank and mobile persisted to `localStorage`; WhatsApp agent session tokens; attendance PIN. | `Dashboard.jsx:207-225`; `MyDonors.jsx:757-764`; `WhatsAppChat.jsx:76-83`; `AdminAttendance.jsx:53` | Keep in memory or `sessionStorage` with explicit expiry. Never persist Aadhaar, PAN, bank or tokens. | 1 d |
| P1-I | `/docs/*` open to every role — a free reconnaissance package with schema, `aadhaar_number` columns and the JWT flow. | `App.jsx:205-209`; `panels/documentation/data/*.js` | Restrict to `super_admin`/`developer`, or remove from the production bundle. | 0.5 d |
| P1-J | `trust proxy 'loopback'` while the proxy (Caddy on prod, nginx on HEAD) is a different hop; a limiter would see the proxy IP. | `index.js:118` | Set the hop count to match reality and verify the observed IP in staging. Both proxies already proxy from `127.0.0.1`, so `'loopback'` is correct as written — verify, don't assume. | 0.5 d |

### P2 — medium, defence in depth

| ID | Finding | Evidence | Fix | Effort |
| --- | --- | --- | --- | --- |
| P2-A | 15 of 323 query sites interpolate `${}`; `ORDER BY`/identifier fragments built dynamically. | `customerProvision.js:118-128`; `index.js:700,731-732`; `config/db.js:827,1180-1188`; `accountsController.js:1864`; `bankAuditModel.js:75` | Convert values to placeholders; allow-list identifiers. Lint rule rejecting `_pool.query` with `${`. | 2 d |
| P2-B | 9 of 18 multer instances lack a `fileFilter`; `originalname` unsanitised into an S3 key. | `froWhatsAppService.js:743` + 8 | Add MIME+extension allow-lists, server-side size caps, server-generated filenames. | 1 d |
| P2-C | ~854 inline `err.message` returns to clients. A correct `sanitizeError` exists with zero importers. | 82 files; `backend/src/utils/errors.js` | Return a stable code, log detail server-side. Wire in the existing sanitiser. | 2 d |
| P2-D | No schema validation in the backend. | `backend/package.json` | Add `zod`; validate every body. | 2 d |
| P2-E | `xlsx@^0.18.5` below the 0.20.x security line, parsing spreadsheets on 6 import routes; `multer@1.x` EOL; `docxtemplater`/`pizzip` zip handling; `@xone-labs/aadharjs@0.0.2` unofficial. | `backend/package.json` | Upgrade or replace; pin by lockfile. | 1 d |
| P2-F | 4× 100-year tokens; no `algorithms` pin on 9 `jwt.verify` sites; socket join uses the raw role. | `whatsappCrmAuthController.js:6,70,81`; `froWhatsAppAuthController.js:75,122-126`; `config/db.js:1229-1233`; `socket.js:57,66` | Bound lifetimes, pin algorithms, normalise roles. | 1 d |
| P2-G | 3 divergent API clients; `API_BASE` has no fallback; a production host hardcoded in `metropad`. | `metropad/services/api.js:3,19-22`; `bill-reminder/api.js:25-39`; `lib/apiBase.js:1-2` | Consolidate on one wrapper with a fallback; add a 401 handler. | 1 d |
| P2-H | Client-side upload caps ignore ~33% base64 expansion, so pastes fail late after the 10 MB buffer. | `usePasteImage.js:38-47`; `LeadAudit.jsx:122`; `index.js:123` | Multiply caps by 4/3; enforce in `multer`, not the JSON parser. | 0.5 d |
| P2-I | Unescaped `label` into a same-origin print window; Mermaid `e.message` into `innerHTML`; `securityLevel` not set. | `GenerateQR.jsx:78`; `DiagramViewer.jsx:40-52,67` | Use `textContent`; set `securityLevel` explicitly. | 0.5 d |
| P2-J | `password: '123456'` pre-filled; bcrypt cost 10; 6-char minimum. | `Users.jsx:11,27`; `NGOs.jsx:12,50`; `authController.js:864` | Remove defaults, force change on first login, raise cost to 12 and length to 12. | 0.5 d |

### P3 — low and informational

| ID | Finding | Effort |
| --- | --- | --- |
| P3-A | ~100 MB of committed donor PII datasets and 2 donor `.xlsx` files — purge from history | 0.5 d |
| P3-B | 20 unpinned CI actions; 4 of 5 workflows with no `permissions:` block | 0.5 d |
| P3-C | `${{ inputs.worker }}` interpolated into a shell command in `inspect-fro-timer.yml:48` — pass via `env:` | 0.5 h |
| P3-D | Unverified LibreOffice RPM downloaded and installed as root on **every** deploy — add checksum/signature | 0.5 d |
| P3-E | Post-deploy curl only warns — make it `exit 1` | 0.5 h |
| P3-F | CI injects `VITE_WHATSAPP_MASTER_*` into the client build; move WhatsApp master auth server-side | 1 d |
| P3-G | `backend/.gitignore` does not ignore `.env` — only the root one does | 0.5 h |
| P3-H | No lint, no `npm audit`, no secret scanner, no dependabot, no CODEOWNERS, no `SECURITY.md`, no pre-commit hook | 2 d |
| P3-I | Retention schedule not implemented; restore-test SNS notify silently no-ops | 1 d |
| P3-J | Aadhaar/PAN/bank unmasked in list and modal views; bank printed in worker reports — add a masked-by-default pattern like `SalaryPrivacyContext.jsx:94-112` | 1 d |

### Execution order

```
P0-D  (rotate + purge; longest lead time — start it first, it needs other people)
  ↓
P0-A → P0-B → P0-C → P0-G → P0-H   (gate the admin/PII surfaces)
  ↓
P0-E → P0-F                      (webhook + auth hardening)
  ↓
P1-E → P1-F → P1-G               (headers, CORS, then cookies — these three are one unit)
  ↓
P1-A → P1-B → P1-C → P1-D        (uploads, XSS, credentials)
  ↓
P1-H → P1-I → P1-J
  ↓
P2-* → P3-*
```

P0-D gates nothing else technically but has the longest lead time, so it starts
first and runs in parallel. P1-E/P1-F/P1-G must ship as a single unit: moving
the token to a cookie while CORS is still `origin: '*'` converts a
non-exploitable CORS misconfiguration into a CSRF vulnerability.

---

## 6. Verification gates

### Header and edge checks

```bash
# Security headers must all be present
curl -sI https://api.beingsevak.org \
  | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy'

# TLS floor — must fail
curl -sI --tls-max 1.1 https://api.beingsevak.org
```

### Exposure checks — must all fail

```bash
# Arbitrary SQL must not be reachable without a token
curl -s -X POST https://api.beingsevak.org/api/db/query \
  -H 'content-type: application/json' \
  -d '{"sql":"select 1"}'                                  # must be 401/403

# Uploads must not be world readable
curl -sI https://api.beingsevak.org/uploads/                 # must be 401/403/404

# Beneficiary PII must not be anonymous
curl -s https://api.beingsevak.org/api/beneficiaries/        # must be 401/403

# Env admin must not fail open
curl -s https://api.beingsevak.org/api/envadmin/all          # must be 401/403/503
```

### Secret and auth checks

A scanner now exists: **`cd backend && npm run security:check`**
(`backend/scripts/security-check.mjs`). It scans **tracked** files only, so it is
safe in CI and never reads `node_modules` or a local build. Rules:

| ID | Detects |
| --- | --- |
| SN-01 | Postgres connection string with an inline password |
| SN-02 | Meta WhatsApp Cloud API token |
| SN-03 | AWS access key ID |
| SN-04 | GitHub token |
| SN-05 | Live payment / AI provider key |
| SN-06 | Private key block |
| SN-07 | Signed JWT (not a decoded sample) |
| SN-08 | A secret read from a `VITE_` variable |
| SN-09 | Hardcoded credential in source |
| SN-10 | Indian PAN number *(opt-in: `--pii`)* |
| SN-11 | 12-digit Aadhaar-shaped number *(opt-in: `--pii`)* |
| SN-12 | A real value in a tracked `.env.example` |

`--staged` scans only what is about to be committed; `--pii` adds the
high-volume PII-shape rules. Values are redacted in all output, so findings are
safe to paste into an issue. False positives are suppressed through
`ALLOW_EXACT` with a justifying comment — never by loosening a rule.

```bash
cd backend && npm run security:check          # whole repo
cd backend && npm run security:check:staged  # pre-commit
cd backend && npm run security:check -- --pii # include PAN / Aadhaar shapes
```

**Current result: 13 findings, all real.** 5 Postgres DSNs
(`backend/scripts/*`), 4 Meta tokens (`others/imp files/privacy/whatsapp.txt`),
1 AWS key (`others/imp files/docs/BACKUP_DISASTER_RECOVERY.md:381`), 1 `VITE_`
secret read (`whatsapp-crm/src/panels/whatsapp-crm/lib/supabase.ts:4`), and the
shared ticket password in `TicketGate.jsx:6` / `TechnicalTickets.jsx:10`.

Because those 13 are unrotated, the scanner **must not be wired as a blocking CI
step yet** — it would fail every build. Wire it as non-blocking (`continue-on-error`)
now, and make it blocking in the same change that lands the rotation.

### Manual checks

```bash
# No tracked .env (must return nothing)
git ls-files | Select-String '\.env$'

# Auth throttling — must start returning 429
# 10 rapid POSTs to /api/auth/login

# Webhook forgery must be rejected
curl -s -X POST https://api.beingsevak.org/api/whatsapp/webhook \
  -H 'content-type: application/json' -d '{}'              # must be 401
```

### Build and test gates

```bash
cd backend; npm test                # must be green
cd backend; npm run security:check  # must be clean
cd client;  npm run build           # must succeed
```

A deploy check that only warns is not a gate. `deploy-frontend.yml:102-109`
must fail the job.

---

## 7. Secret rotation runbook

**Trigger:** P0-D — the credentials below are in git history and must be
considered public. Values are deliberately **not** reproduced in this document.

### Rotate now, in this order

| # | Secret | Where it leaked | Action | Blast radius |
| --- | --- | --- | --- | --- |
| 1 | Meta WhatsApp Cloud API access tokens (4) | `others/imp files/privacy/whatsapp.txt:3,11,22,26` | Revoke in Meta Business Manager, issue new tokens, update the environment, restart | Message sending stops until replaced |
| 2 | RDS superuser password (`ucs_admin`) | 5 `backend/scripts/*` DSNs | Rotate, then re-issue a **least-privilege** `ucs_app` role and use only that in code | Short write outage during rotation |
| 3 | AWS access key | `others/imp files/docs/BACKUP_DISASTER_RECOVERY.md:381` | Delete the key, issue a scoped replacement for backups only | Backups stop until replaced |
| 4 | `ADMIN_PASSWORD` (super-admin) | `backend/.env.example` (scrubbed on this branch) | Rotate, store as a bcrypt hash (P0-F), force change | Brief admin lockout |
| 5 | `WHATSAPP_MASTER_PASSWORD` | `backend/.env.example`, `deploy-frontend.yml:44`, `client/.env:24` | Rotate, move authentication server-side, delete from CI and from `client/.env` | Master session re-auth needed |
| 6 | `SCRAPER_DEVICE_KEY` | `apps/scrapper/lib/api_config.dart:2` — shipped in the APK | Rotate, move to a server-side attestation | Re-provision the device |
| 7 | `geoapify` third-party key | `apps/hr-attend/lib/config.dart:3` | Rotate at the provider | Quota/billing impact |
| 8 | Shared ticket-gate password | `TicketGate.jsx:6`, `TechnicalTickets.jsx:10`, and the built bundle | Delete the comparison entirely, then rotate (P1-D) | None once the gate is removed |

### Already done on this branch

- `backend/.env.example` scrubbed of every real value; it is now names and
  placeholders only, with a warning header (SEC-REQ-37).
- `backend/.gitignore` now ignores `.env`, `.env.*` and `*.env` while keeping
  `.env.example` tracked, so a standalone `backend/` clone is safe (SEC-REQ-38).
- `backend/scripts/security-check.mjs` added and wired as
  `npm run security:check` — 12 rules, redacted output, `--staged` and `--pii`
  modes (SEC-REQ-40).

### Then purge history

1. Coordinate — this force-pushes and invalidates every existing clone.
2. `git filter-repo --invert-paths --path others/imp files --path others/imp\ files`
   plus targeted `--replace-text` for the specific values.
3. Force-push all branches and tags; ask every contributor to re-clone.
4. Re-run the secret scan in [§6](#6-verification-gates) against the
   rewritten history.
5. Treat the AWS account, the database, and Meta as having been compromised for
   the whole exposure window. Review access logs for the period.

### Then prevent recurrence

- Add `.env`, `.env.*` to **every** package's `.gitignore` (P3-G).
- Add a secret scanner to CI (P3-H) — nothing currently would have caught these.
- Add the VITE-secret-name check to the client build (P0-F remediation).
- Add the `postgres://user:pass@` and `EAAG` patterns to the audit script in
  [SECRETS-MANAGEMENT.md](SECRETS-MANAGEMENT.md).

---

## 8. Incident response

If a leak is suspected:

1. **Contain first** — rotate the affected secret, revoke sessions, close
   database ingress. Do not investigate before containing.
2. **Preserve evidence** — logs, access records, the affected file or commit.
   Do not delete or amend history until it is captured.
3. **Assess** — which data, how many records, who had access, for how long.
4. **Notify** — determine whether the DPDP Act 2023 breach-notification duty is
   triggered, and involve legal and leadership. Assume notification is required
   until counsel says otherwise.
5. **Remediate the source** — fix, then purge history per
   [§7](#7-secret-rotation-runbook).
6. **Write it up** — add a finding to [FINDINGS.md](FINDINGS.md) so the next
   audit starts from what was learned, and re-check whether the standard in
   [§3](#3-the-standard--what-ucs-crm-must-satisfy) needed a new requirement.

For personal-data breaches, the default assumption is that notification is
required.

---

## 9. Governance

### Ownership

| Area | Owner |
| --- | --- |
| `backend/` API, authorization, SQL, uploads | Backend maintainer |
| `client/` SPA, XSS sinks, browser storage | Frontend maintainer |
| CI/CD, deploy pipelines, secrets | Whoever holds the deploy role |
| Caddy edge (prod), nginx (HEAD), TLS, DNS | Whoever holds the host |
| Data protection, retention, DPDP compliance | Leadership + counsel |

Every `SEC-REQ` in [§3](#3-the-standard--what-ucs-crm-must-satisfy) needs a named
owner before the P0 work starts. An unowned control is not a control.

### Review cadence

- **This document** — reviewed on every release that touches auth, uploads,
  CORS, the edge, or personal data, and at minimum quarterly.
- **[FINDINGS.md](FINDINGS.md)** — append-only. IDs are stable and safe to
  reference from issues and commits. Mark findings `Confirmed` only when
  verified by reading code, not inferred.
- **[HARDENING-CHECKLIST.md](HARDENING-CHECKLIST.md)** — worked through before
  each release.

### Re-audit triggers

Re-run the audit when any of these change:

- token storage mechanism (the P1-G remediation),
- the CORS policy (P1-F),
- the reverse proxy configuration (P1-E),
- any new public static mount,
- any new outbound integration or webhook,
- any new role, or any new router mount in `index.js`,
- a new sub-application in `apps/`, `others/` or `metro/`.

### Ground rules

- Client-side role checks are **never** a security control. They are rendering
  sugar. `client/src/components/chat/chatIdentity.js` states this explicitly and
  that comment is correct.
- Any new secret belongs in the environment — never in source, never in a
  `VITE_`-prefixed variable.
- Any new HTML injection point needs sanitisation and a justifying note.
- Any new route mount must declare its auth gate, or it is a defect.

---

## 10. Known unassessed surface

The reference documents scope themselves to `client/` and `backend/`. The
repository contains substantially more than that. **None of the following has
been assessed**, and each is a candidate for the next audit:

| Surface | Scale | Why it matters |
| --- | --- | --- |
| 6 Flutter / Android apps under `apps/` | 729 files, 129 `.dart`, 23 `.kt` | Same API, on unmanaged devices. `apps/scrapper` ships a device key in the APK. `apps/beneficiaries` commits 128 native `.so` libraries. |
| `whatsapp-crm/` | 70 files, multi-tenant | Reads/writes a long-lived Meta access token from a Supabase `tenants.settings` row — client-reachable by design. |
| 8 SPAs under `others/` | 271 files | `client-web`, `hr form`, `reminder alarm`, `database`, `voting`, `recruit-quizz`, `metropad`, `env-admin.html`. `others/database` is a client of the unauthenticated SQL API in P0-A. |
| `metro/` | 88 files | 10 committed build artefacts in `dist/`. |
| AWS Lambda pg_dump | `backend/scripts/backup/lambda-pg-dump/` | A second serverless compute unit holding database access, with a 1.24 MB committed `function.zip`. |
| Committed build output | 4 `dist/` trees | `metro/`, `others/database/`, `others/recruit-quizz/`, `others/reminder alarm/` (the last ships a service worker). |
| Mobile-exposed API surface | — | The API serves the mobile apps, so every authorization gap is reachable from an un-managed device. |
| `LOCAL_DB_ACCESS` path | `localDbAccess.js`, `add-db-client.mjs` | Opens TCP 5432 to a CIDR range. Default-deny behaviour needs confirming. |

Until these are assessed, the honest statement of this project's security
posture is: **the assessed surface has unresolved critical exposures, and the
unassessed surface is larger than the assessed one.**
