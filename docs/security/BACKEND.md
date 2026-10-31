# Backend & API Security

## Stack

Express on Node, behind Caddy (nginx on the HEAD host), run under PM2. Notable dependencies
(`backend/package.json`):

| Package | Version | Note |
| --- | --- | --- |
| `express` | — | HTTP layer |
| `cors` | `^2.8.5` | configured with `origin: '*'` — SEC-007 |
| `jsonwebtoken` | `^9.0.2` | algorithm not pinned — see [AUTHENTICATION.md](AUTHENTICATION.md) |
| `bcryptjs` | `^2.4.3` | password hashing |
| `express-rate-limit` | `^8.5.2` | installed but used **only** in `chatRoutes.js` — SEC-006 |
| `multer` | `^1.4.5-lts.1` | multipart uploads |
| `pg` | `^8.22.0` | direct SQL alongside a query-builder client |

**`helmet` is not a dependency.** There are no security headers on the API
origin either (SEC-003).

## Middleware order

From `backend/src/index.js`:

| Line | Middleware | Assessment |
| --- | --- | --- |
| 116 | `app.set('trust proxy', 'loopback')` | hop count must match the real chain — SEC-015 |
| 118 | `cors({ origin: '*', … })` | SEC-007 |
| 123 | `express.json({ limit: '10mb' })` | large bodies buffered before validation — SEC-019 |
| 179 | `app.use('/api', localDbAccess)` | see below |
| 197-277 | ~80 routers | each must carry an explicit auth gate — SEC-001 |
| 308 | `POST /api/whatsapp/send` | `authenticate` applied inline |
| 501 | `app.use('/uploads', express.static(…))` | **unauthenticated** — SEC-005 |
| 893 | error handler | review for leakage |
| 928 | `app.listen(PORT, '0.0.0.0')` | binds all interfaces; rely on the proxy to restrict |

Two things stand out:

- **`/uploads` (line 501) is mounted with no middleware.** Every uploaded file is
  world-readable if the path is known. Donor paperwork, bank statements,
  certificates and payment screenshots are in scope. This is SEC-005 and should
  be the first backend fix.
- **`localDbAccess` on `/api` (line 179)** is gated by the `LOCAL_DB_ACCESS` and
  `LOCAL_DB_ACCESS_RULE_TTL_HOURS` settings. Confirm the default is deny and that
  the AWS security-group rule it creates is removed when the TTL expires.

Static panel bundles are also served from the same process
(`index.js:767-812`): `/bank-import`, `/whatsapp/assets`,
`/database/assets`, `/assets`, `/admin/assets`, `/accounts/assets`,
`/recruit-quizz/assets`. These are build artefacts and are fine, but any of them
can become a disclosure path if a build is left in the source tree — confirm
`dist/` folders are gitignored.

## Authentication enforcement

See [AUTHENTICATION.md](AUTHENTICATION.md) for the token mechanics. The audit
task is to confirm every router mount has a gate. The known gap is
`developerTicketRoutes.js:11`, which applies only `authenticate`, so any valid
token of any role can list and approve developer tickets (SEC-001).

## Rate limiting

Only `chatRoutes.js` uses `express-rate-limit`. There is no limiter on:

- `/api/auth/login`, `/api/workers/login` — credential stuffing (SEC-006)
- `/api/impersonation-codes` — code guessing
- `/api/otp*` style endpoints
- `POST /api/whatsapp/send` — message relay abuse
- bulk import/export routes — memory and database pressure

Add a strict per-IP and per-identifier limiter on auth, a coarse global limiter,
and confirm `trust proxy` so the client IP is resolved correctly.

## Input validation

There is no schema-validation library in the backend. `zod` exists in the client
(`client/package.json`) but is not used server-side. Validation is ad-hoc and
per-route, so coverage is uneven by construction.

Minimum bar for every route that accepts a body:

1. Type and range check every field.
2. Coerce and bound pagination (`LIMIT`/`OFFSET`).
3. Validate every value that reaches SQL, including `ORDER BY` columns, against
   an allow-list.
4. Reject unknown fields on high-value endpoints.

## SQL injection

The database is reached two ways: a query-builder client (Supabase-style) and
direct `pg` via `db._pool.query()`.

- **68 raw SQL call sites across 16 files**, and **268 lines** using `$1`-style
  placeholders, so most raw SQL is correctly parameterised.
- The residual risk is sites that interpolate values directly into the string,
  or that build `ORDER BY`/identifier fragments dynamically.

`utils/loanTerm.js` is the pattern to copy: the business rules are pure
functions with no database import, fully unit tested, so the risky layer only
performs parameterised I/O. See SEC-012 and add a lint rule against
`_pool.query` with `${` inside the template.

## File uploads

`multer` handles multipart uploads. Confirm for every upload route:

- A MIME **and** extension allow-list, validated server-side (the client `accept=`
  attribute is a picker hint only).
- A size cap enforced by `multer`, not by the client.
- Filenames regenerated server-side (never trust `originalname`), and stored
  outside any web-served root.
- Uploads served only through an authorising controller — never `express.static`
  (SEC-005).

The best existing example is the chat path: a real MIME allow-list and a 25 MB
cap in `client/src/components/chat/chatIdentity.js:116-145`, mirrored by
`backend/src/controllers/chatController.js:20` (`MAX_FILE_BYTES`). Replicate that
pattern rather than inventing another.

## CORS

`origin: '*'` with `x-admin-key` in `allowedHeaders` (SEC-007). Replace with an
explicit origin allow-list and drop `x-admin-key` unless a browser client needs
it. **Never** combine a wildcard origin with credentials — that is the change
that makes the `localStorage`-to-cookie migration in SEC-004 safe.

## Webhooks

`/api/webhooks` and the WhatsApp/Razorpay integrations accept callbacks. Verify
each verifies its signature using the raw body — note `express.json` already
captures `req.rawBody` (`index.js:124-126`), which is what signature
verification needs. Confirm Razorpay's `webhook_secret` comparison is
constant-time and that replay is prevented with a timestamp window.

## Error handling

The global handler is at `index.js:893`. It must not return stack traces, SQL
fragments, or driver messages to the client — those leak schema and library
versions. Return a stable error code and log the detail server-side
(SEC-014).

## Logging

Confirm the logger does not write JWTs, passwords, Aadhaar/PAN, salary, or full
request bodies. The client currently `console.error`s API failures in several
places (for example `panels/hr/components/Letters.jsx:1009,1023`) — a browser
console is not an appropriate place for server detail, and it is visible to the
user.

## Deployment

Both AWS deploy workflows were removed (no AWS deployment). Backend and frontend
are now shipped manually: backend under PM2 on the app host, and the client
bundle copied into the web root that serves it. Add a post-deploy HTTP check
against whatever host serves the bundle, and make it a hard failure, otherwise a
broken or hijacked deploy is reported as success.
