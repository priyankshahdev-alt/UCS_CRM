# UCS CRM — Project Inventory

> **Document ID:** 00-Project-Overview/PROJECT-INVENTORY
> **Status:** Verified (structure and file counts) / Partially verified (runtime behavior)
> **Generated:** 2026-10-13
> **Source of truth:** repository working tree at branch `master`
> **Scope of this documentation set:** the primary CRM applications only — `backend/` and `client/`. Satellite systems (`apps/`, `whtsapp/`, `others/`) are listed here for orientation but are documented only where they interact with the primary CRM.

This inventory is the result of Phase 1 of the documentation build. It records **what actually exists in the repository**. Nothing here is inferred from "a typical CRM" — every item is traceable to a file or directory.

Status labels used throughout the documentation set:

| Label | Meaning |
| --- | --- |
| **Verified** | Directly confirmed in code/configuration. |
| **Partially verified** | Some aspects confirmed; others not yet checked. |
| **Inferred** | Based on indirect evidence; requires validation. |
| **Planned** | A recommendation, not an existing feature. |

---

## 1. Repository Structure

The repository is a multi-application monorepo (not a package-manager workspace; each app manages its own dependencies).

```
UCS_CRM/
├── backend/                 Primary REST API + realtime server (Node.js / Express, ESM)
├── client/                  Main CRM single-page application (React 19 / Vite 6)
├── apps/                    8 Flutter mobile/desktop applications
├── whtsapp/                 Vendored WhatsApp workspace (WhatsApp CRM API backend + React client)
├── others/                  9 standalone React SPAs / PWAs and reference documents
├── infra/                   Deployment configuration (Caddyfile, nginx conf, README)
├── scripts/                 Local-to-HEAD sync automation (sync-head.ps1)
├── docs/                    This documentation set (+ existing security set)
├── .github/workflows/       CI/CD pipelines
├── incident/                Incident notes
├── key/  public/  assets/   Support material (contents not audited for this set)
└── .opencode/               Tooling configuration
```

| Application | Path | Stack | Status | Evidence |
| --- | --- | --- | --- | --- |
| CRM Backend API | `backend/` | Node 24, Express 4, PostgreSQL | **Verified** | `backend/package.json`, `backend/src/index.js` |
| CRM Client SPA | `client/` | React 19, Vite 6, React Router 7, Tailwind 4 | **Verified** | `client/package.json`, `client/src/App.jsx` |
| Flutter apps | `apps/*` | Flutter / Dart | Active/legacy mix | each `apps/*/pubspec.yaml` |
| WhatsApp workspace | `whtsapp/` | Node/Express + React + Vite | Vendored | `whtsapp/backend`, `whtsapp/frontend` |
| Standalone web tools | `others/*` | React 19 + Vite (+ Supabase for sevak-library) | Active | each `others/*/package.json` |

**Verified:** `backend/` and `client/` are the two production deploy targets (see `infra/README.md`). No AWS deploy workflows remain; deploys are manual.

---

## 2. Applications and Technology Stack (primary CRM)

### 2.1 Backend (`backend/`)

| Aspect | Value | Evidence |
| --- | --- | --- |
| Runtime | Node.js `24.x` | `backend/package.json` `engines.node` |
| Module system | ESM (`"type": "module"`) | `backend/package.json` |
| Framework | Express `^4.18.2` | `backend/package.json` |
| Database | PostgreSQL | `backend/src/config/db.js`; raw SQL via `pg` pool |
| DB access style | Supabase JS client query builder **plus** raw `pg` SQL (no ORM) | `backend/src/config/db.js`, `db._pool` usage in `backend/src/index.js` |
| Auth | JWT (`jsonwebtoken` `^9.0.2`) + `bcryptjs` `^2.4.3` | `backend/src/middleware/authMiddleware.js` |
| Realtime | Socket.IO `^4.8.3` | `backend/src/socket.js` |
| Scheduled jobs | `node-cron` `^4.2.1` + cron HTTP endpoints | `backend/src/services/*Scheduler.js`, `backend/src/index.js` |
| File handling | `multer`, `exceljs`, `xlsx`, `sharp`, `pdfkit`, `docxtemplater` | `backend/package.json` |
| AI | `groq-sdk` `^1.2.1` | `backend/src/config/groq.js` |

**Backend source counts (Verified, counted 2026-10-13):**

| Artifact | Count | Location |
| --- | --- | --- |
| Route files | 86 | `backend/src/routes/` |
| Controllers | 89 | `backend/src/controllers/` |
| Models | 91 | `backend/src/models/` |
| Services | 76 | `backend/src/services/` |
| Schema bootstraps | 27 | `backend/src/bootstrap/` |
| Utilities | 57 | `backend/src/utils/` |
| SQL migration files | 6 (root) + 7 (`src/migrations`) | `backend/migrations/`, `backend/src/migrations/` |
| Test files (`*.test.js`) | see §9 | across `src/` |

> **Counting note:** artifact counts are `*.js` files including co-located `*.test.js`; the [MODELS-INDEX](../05-Database-Documentation/MODELS-INDEX.md) enumerates the 88 model modules only (3 `*.test.js` excluded). Counts refreshed after the CRM-agents removal.

### 2.2 Client (`client/`)

| Aspect | Value | Evidence |
| --- | --- | --- |
| Framework | React `^19.2.6` | `client/package.json` |
| Build tool | Vite `^6.4.3` | `client/package.json` |
| Routing | React Router DOM `^7.18.1` | `client/src/App.jsx` |
| Styling | Tailwind CSS `^4.3.2` | `client/package.json` |
| Server state | TanStack React Query `^5.101.2` | `client/package.json` |
| Client state | React Context + one `zustand` store | `client/src/store.jsx`, `client/src/context/accessCodeStore.js` |
| Forms/validation | React Hook Form + Zod | `client/package.json` |
| Charts | Recharts `^3.9.2` | `client/package.json` |
| Diagrams | Mermaid `^11.16.0` | `client/src/panels/documentation/components/DiagramViewer.jsx` |
| Realtime | `socket.io-client` `^4.8.3` | `client/src/lib/socket.js` |
| HTTP | hand-rolled `fetch` wrapper (axios only in Metropad sub-app) | `client/src/api/auth.js` |

**Client source counts (Verified):** 598 files under `client/src/`, of which 14 panel folders exist under `client/src/panels/`.

---

## 3. Discovered Panels and User Roles

Panels are declared in `client/src/App.jsx` (`ROLE_PATHS`, `ROLE_PANELS`, and `<Route>` guards). Roles are normalized on the backend in `backend/src/middleware/authMiddleware.js` (`ROLE_ALIASES`, `normalizeRole`).

| # | Panel | Route base | Panel entry file | Allowed roles (client guard) |
| --- | --- | --- | --- | --- |
| 1 | Super Admin | `/sa/*` | `panels/super-admin/SuperAdminPanel.jsx` | `super_admin` |
| 2 | HR | `/hr/*` | `panels/hr/HRPanel.jsx` | `hr`, `HR`, `super_admin` |
| 3 | NGO Admin | `/ngo-admin/*` | `panels/ngo-admin/NgoAdminPanel.jsx` | `admin` |
| 4 | FRO | `/fro/*` | `panels/fro/FROPanel.jsx` | `fro`, `worker`, `FRO` |
| 5 | Accounts | `/accounts/*` | `panels/accounts/AccountsPanel.jsx` | `accounts`, `admin` |
| 6 | Recruiter | `/recruiter/*` | `panels/recruiter/RecruiterPanel.jsx` | `recruiter`, `HR-Recruiter`, `super_admin` |
| 7 | Event Head | `/event-head/*` | `panels/event-head/EventHeadPanel.jsx` | `event_head`, `Event Head`, `Event Manager` |
| 8 | Developer | `/dev-panel/*` | `panels/dev-panel/DevPanel.jsx` | `developers`, `developer`, `digital`, `Developer`, `Developers`, `Digital`, `super_admin` |
| 9 | Social | `/social/*` | `panels/social/SocialPanel.jsx` | `social`, `digital`, `Social`, `Social Media`, `Digital`, `super_admin` |
| 10 | WhatsApp | `/wa/*` | `panels/whatsapp/WhatsAppPanel.jsx` | `*` (any authenticated user) |
| 11 | SIM Card | `/sim/*` | `panels/sim-card/SimCardPanel.jsx` | `super_admin`, `admin`, `hr`, `accounts` |
| 12 | Documentation | `/docs/*` | `panels/documentation/DocumentationPanel.jsx` | `*` (any authenticated user) |

**Embedded panels (no standalone route):** `beneficiaries` (mounted at `/accounts/beneficiaries/*`) and `sevak-library` (mounted at `/accounts/library` and `/hr/library`).

**Login root redirect (`/`)** is resolved by `panelPathFor(user)` in `client/src/App.jsx` — role first, department used only to disambiguate `digital` vs `develop*`.

**Role list observed in code (Verified):** `super_admin`, `admin`, `hr`, `accounts`, `fro`, `worker`, `recruiter`, `event_head`, `event_manager`, `developer(s)`, `digital`, `social`. Additional backend aliases exist in `ROLE_ALIASES` (e.g. `HR-Recruiter` → `recruiter`, accountant → accounts).

---

## 4. Modules and Submodules

The functional modules discovered from routes, controllers, models and panel screens:

| Domain | Representative modules | Primary route file(s) |
| --- | --- | --- |
| Authentication & session | login/logout, impersonation, work-as | `authRoutes.js`, `codeRoutes.js` |
| Attendance | attendance, corrections, biometric, selfie punch, QR | `attendanceRoutes.js`, `attendanceCorrectionRoutes.js`, `biometricRoutes.js`, `qrRoutes.js` |
| Workers / HR | workers, leaves, salary, loans/advances, letters, holidays, HR reports | `workerRoutes.js`, `leaveRoutes.js`, `salaryRoutes.js`, `loanRoutes.js`, `letterRoutes.js`, `holidayRoutes.js`, `hrRoutes.js` |
| Recruitment | recruiters, leads, call logs, onboarding | `recruiterRoutes.js`, `leadRoutes.js`, `callLogRoutes.js`, `onboardingRoutes.js` |
| FRO operations | FRO dashboard, donations/donor logs, WhatsApp assignment, targets | `froRoutes.js`, `froWhatsAppRoutes.js`, `incentiveRoutes.js` |
| Accounts / finance | accounts, bank statement/audit, email import, scraper, receipts, reports | `accountsRoutes.js`, `bankStatementRoutes.js`, `bankAuditRoutes.js`, `emailImportRoutes.js`, `scraperRoutes.js`, `reportRoutes.js` |
| Incentives | incentive setup, slabs, special, lead incentives | `incentiveRoutes.js`, `specialIncentiveRoutes.js`, `leadIncentiveRoutes.js` |
| Beneficiaries | beneficiaries, programs, benefits, distributions, import | `beneficiaryRoutes.js`, `programRoutes.js`, `benefitRoutes.js`, `distributionRoutes.js`, `beneficiaryImportRoutes.js` |
| Events | events, event head, attendees, important days, calendar | `eventRoutes.js`, `eventHeadRoutes.js`, `importantDaysRoutes.js`, `calendarRoutes.js` |
| Communication | chat, notices, notifications, tickets, WhatsApp CRM | `chatRoutes.js`, `noticeRoutes.js`, `notificationRoutes.js`, `ticketRoutes.js`, `whatsappRoutes.js`, `whatsappCrmRoutes.js` |
| SIM inventory | sim cards, sim inventory | `simCardRoutes.js`, `simInventoryRoutes.js` |
| NGO & admin | NGOs, ngo-admin, super-admin, ngo allocations, operators | `ngoRoutes.js`, `ngoAdminRoutes.js`, `superAdminRoutes.js`, `ngoAllocationRoutes.js`, `operatorRoutes.js` |
| Platform | config, settings, data import, S3 browser, env admin, temp cleanup | `configRoutes.js`, `settingsRoutes.js`, `dataImportRoutes.js`, `s3BrowserRoutes.js`, `envAdminRoutes.js`, `tempCleanupRoutes.js` |

> Detailed per-panel module documentation is produced in `docs/03-Panel-Documentation/` (Phase 3).

---

## 5. Database Technologies

| Item | Value | Evidence |
| --- | --- | --- |
| Primary database | PostgreSQL | `backend/src/config/db.js`; `pg` dependency |
| Access layer | Supabase JS client query builder (`db.from(...)`) + raw `pg` pool (`db._pool.query`) | `backend/src/config/db.js`, `backend/src/index.js` |
| ORM | None | No Sequelize/TypeORM/Prisma dependency |
| Schema management | Application-level bootstrap functions run at startup + ad-hoc SQL migrations | `backend/src/bootstrap/*.js`, `backend/migrations/`, `backend/src/migrations/` |
| Realtime changes | Socket.IO custom events + `onDbChange` client helper | `backend/src/socket.js`, `client/src/lib/socket.js` |
| Models | 91 model modules (query/data-access style) | `backend/src/models/` |

**Note (Verified):** there is **no single canonical migration chain**; schema readiness is primarily enforced by 27 `ensure*Schema.js` bootstrap functions invoked at server startup (`backend/src/index.js`), with SQL migrations used for specific changes.

---

## 6. API Structure

- All application routes are mounted under `/api/*` in `backend/src/index.js` (86 router files, plus inline handlers).
- Auth is JWT bearer token via `Authorization: Bearer <token>`, verified in `backend/src/middleware/authMiddleware.js`.
- Router mounts are enumerated with their prefixes in `backend/src/index.js`. Route prefix → router mapping is documented in `docs/06-API-Reference/` (Phase 4).
- A pre-existing **Postman collection with 243 endpoint entries** exists at `others/imp files/docs/postman/ucs-crm-postman-collection.json`. It is treated as reference material only and will be re-verified against `backend/src/routes/` before inclusion.
- Cron/scheduled entry points are HTTP-triggered and protected by `CRON_API_KEY` (`backend/src/index.js`): notifications, email import, Razorpay sync, DB health, FRO auto-logout, FRO month rollover, FRO idle reconcile, Sevak renewals.

---

## 7. External Integrations

| Integration | Purpose | Evidence |
| --- | --- | --- |
| WhatsApp (Meta Cloud API) | Messaging, CRM inbox, templates | `backend/src/config/whatsappConfig.js`, `backend/src/services/whatsappService.js` |
| Razorpay | Payment gateway / webhooks / sync | `backend/src/config/paymentGatewayConfig.js`, `backend/src/services/razorpayWebhook.js` |
| Paytm | Payment gateway / webhooks | `backend/src/services/paytmWebhook.js` |
| Firebase Admin (FCM) | Push notifications | `backend/src/config/firebase.js`, `backend/src/services/fcmService.js` |
| Groq (LLaMA) | AI reply / suggestions | `backend/src/config/groq.js`, `backend/src/services/aiReplyService.js` |
| Gemini | AI fallback | `backend/src/utils/geminiClient.js` |
| AWS S3 / EC2 / Backup / CloudWatch / RDS / IAM | Storage, hosting, backups, capacity | `backend/src/index.js`, `backend/src/services/s3Browser.js`, `rdsCapacity.js` |
| IMAP email import | Bank statement email ingestion | `backend/src/config/emailConfig.js`, `backend/src/services/emailImporter.js` |
| Supabase | DB client + Sevak Library backend | `backend/src/config/db.js` |
| Redis (ioredis) | Caching / queues | `backend/src/config/redis.cjs` |
| Google Sheets | Reporting/export | `backend/src/services/googleSheets.js` |
| OCR (OCR.space, Aadhaar decode) | Aadhaar/ID processing | `backend/src/aadhaar/`, `backend/src/controllers/ocrController.js` |
| Calendarific | Holiday/observance data | `backend/src/utils/calendarific.js` |

---

## 8. Hosting and Deployment (discovered)

| Environment | Host | Edge | Process manager | Evidence |
| --- | --- | --- | --- | --- |
| Production | EC2 `13.207.47.116` | Caddy v2.11.4 | PM2 (`backend/ecosystem.config.cjs`) | `infra/README.md`, `infra/caddy/Caddyfile` |
| HEAD / dev | EC2 `52.66.211.205` | nginx (`listen 80`) | PM2 | `infra/nginx/head.conf`, `scripts/sync-head.ps1` |
| Static PWAs | Vercel | — | — | `.github/workflows/deploy-vercel.yml` |
| Sevak Library | Vercel + Supabase | — | — | `others/sevak-library/DEPLOY.md` |

CI/CD workflows (`.github/workflows/`): `deploy-vercel.yml`, `backup-restore-test.yml`, `inspect-fro-timer.yml`. There are no AWS deploy workflows; backend and `client/dist` are published manually.

---

## 9. Testing Coverage

| Item | Value | Evidence |
| --- | --- | --- |
| Framework | Node.js built-in test runner (`node --test`) | `backend/package.json` `scripts.test` |
| Test glob | `src/**/*.test.js` | `backend/package.json` |
| Test file count | 44 across `services/`, `utils/`, `models/`, `config/`, `middleware/` | `Get-ChildItem -Recurse *.test.js` |
| Client test | `test:sidebar` (`node sidebar-smoke.mjs`) | `client/package.json` |
| Coverage tooling | None detected | — |

**Status:** test files exist but were **not executed** during this documentation build. All test results in `docs/09-Testing-and-QA/` are labeled *not executed* unless a command is run and its output recorded.

---

## 10. Environment Variables (names only)

Loaded via `dotenv.config()`. Names are derived from `backend/.env.example` and `client/.env.example`. **Values are never recorded.**

**Backend (from `.env.example`):** `JWT_SECRET`, `PORT`, `WHATSAPP_MASTER_EMAIL`, `WHATSAPP_MASTER_PASSWORD`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION`, `WHATSAPP_WABA_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_TEMPLATE_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `BACKUP_SCHEDULE`, `BACKUP_RETENTION_DAYS`, `BACKUP_MONTHLY_RETENTION_DAYS`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`, `RDS_INSTANCE_IDENTIFIER`, `AWS_REGION`, `LOCAL_DB_ACCESS`, `LOCAL_DB_ACCESS_RULE_TTL_HOURS`, `HEAD_AWS_ACCESS_KEY_ID`, `HEAD_AWS_SECRET_ACCESS_KEY`, `HEAD_S3_BUCKET`, `HEAD_S3_REGION`, `UPSTREAM_AWS_ACCESS_KEY_ID`, `UPSTREAM_AWS_SECRET_ACCESS_KEY`, `UPSTREAM_S3_BUCKET`, `UPSTREAM_S3_REGION`, `SEVAK_SUPABASE_URL`, `SEVAK_SUPABASE_SERVICE_ROLE_KEY`.

**Additional names referenced in code (Verified):** `CRON_API_KEY`, `ENV_ADMIN_KEY`, `VERCEL`, database connection name(s) consumed by `src/config/db.js`.

**Client (from `.env.example`):** `VITE_API_URL`, `VITE_SOCKET_URL`.

> Full names-and-descriptions reference (no values) is produced in `docs/11-Deployment-and-Setup/` (Phase 6).

---

## 11. Existing Documentation Preserved

| Asset | Path | Status |
| --- | --- | --- |
| Security documentation set (12+ docs) | `docs/security/` | **Mature; reference.** Includes a **confirmed open P0** S3 PII exposure (`docs/security/S3-PII-EXPOSURE-REMEDIATION.md`). |
| In-app documentation panel | `client/src/panels/documentation/` | Working `/docs` panel with per-panel Mermaid and API data. Left untouched per project decision. |
| Legacy master documentation | `others/imp files/docs/MASTER_DOCUMENTATION.md` (2,920 lines) + `.docx`/`.html` | **Stale** (cites 47 controllers / 37 models / 42 routes; current is 89/91/86). Used only as a cross-check. |
| Postman collection | `others/imp files/docs/postman/ucs-crm-postman-collection.json` | 243 endpoint entries; used as a seed to re-verify. |
| Cron/backup references | `others/imp files/docs/BACKUP_DISASTER_RECOVERY.md`, `CALENDAR_DAILY_TRACKING.md` | Reference. |
| `docs/PANELS.docx` | `docs/PANELS.docx` | Pre-existing panel reference (content not yet audited). |

---

## 12. Documentation Coverage Status

| Area | Status |
| --- | --- |
| Project inventory | **Complete** (this document) |
| System architecture & stack | Pending (Phase 2) |
| Panel documentation (12 panels) | Pending (Phase 3) |
| API reference | Pending (Phase 4) |
| Database dictionary / ER | Pending (Phase 4) |
| Business logic | Pending (Phase 4) |
| Diagrams / workflows | Pending (Phase 5) |
| Testing / security / deployment / user manual | Pending (Phase 6) |
| Black book assembly + DOCX | Pending (Phase 7) |
| Final audit | Pending (Phase 8) |

---

## 13. Unknowns and Areas Requiring Manual Verification

1. **Database schema truth** — because schema is enforced by runtime bootstraps rather than one migration chain, the exact column set for each table must be confirmed by reading `backend/src/bootstrap/*.js` and model files. Table names are known; full column-level dictionary is Partially verified until then.
2. **Route-level auth** — not every mount's auth gate was inspected; each mount's gate must be confirmed per route in Phase 4 (the security set notes "any new route mount must declare its auth gate").
3. **Cron job schedules** — cron expressions live inside scheduler services; exact timings require reading each `*Scheduler.js`.
4. **Production data/records** — out of scope and must never be captured.
5. **Secrets** — env values are deliberately not read or recorded.
6. **`docs/PANELS.docx`** — contents not yet audited; may duplicate or contradict this set.
7. **Satellite apps** — behavior not documented in this set (scope decision).
8. **Screenshots** — application was not run (requires DB/env); all screenshots are placeholders (scope decision).

---

## 14. Cross-References

- Security posture: [`docs/security/README.md`](../security/README.md)
- Architecture: `docs/02-System-Architecture/` (Phase 2)
- Panels: `docs/03-Panel-Documentation/` (Phase 3)
- Master navigation: [`docs/README.md`](../README.md) (Phase 7)
