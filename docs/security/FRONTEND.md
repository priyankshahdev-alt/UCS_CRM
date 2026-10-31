# Frontend Security

`client/` is a React 19 + Vite 6 SPA (`client/package.json`), served as static
files. It holds no secrets and enforces no permissions. This document describes
what the browser is trusted with, and therefore what the backend must never
assume.

## The core rule

**Everything in the browser is attacker-controlled**, including:

- `localStorage` — the JWT and the `user` object (SEC-004)
- the `user.role` that every `ProtectedRoute` and `canManage` flag reads
- all DOM content, including anything rendered from the database

`client/src/components/chat/chatIdentity.js:9-11` already documents this
correctly:

> Capability derivation is purely for rendering. Hiding the composer is a
> courtesy — the server is the only thing that actually enforces the matrix.

Treat any code that gates on role without a server check as a UI affordance, not
a control. There are roughly 50 such sites (`Donors.jsx:118`,
`Certificates.jsx:111`, `NgoAdminPanel.jsx:291`, `Codes.jsx:46`,
`EmployeeDetail.jsx:64`, `RecentNotices.jsx:34-35` and others).

## Route guard

```jsx
// client/src/App.jsx:53-63
function ProtectedRoute({ role, children }) {
  const { user } = useUcs()
  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles.includes('*')) return children
  if (user.role === 'super_admin' && …) return children
  if (!allowedRoles.includes(user.role) && !allowedRoles.includes(user.department)) {
    return <AccessDenied />
```

`user` is hydrated from `localStorage` (`store.jsx:58-59`). Writing
`{"role":"super_admin","id":1}` to `ucs_user` and reloading satisfies every
guard. Two routes are additionally open to **any** logged-in user via
`role={['*']}`:

- `/wa/*` → `WhatsAppPanel` (`App.jsx:199-203`)
- `/docs/*` → `DocumentationPanel` (`App.jsx:205-209`) — SEC-009, an internal
  engineering wiki shipped in the bundle

## XSS sinks

### `dangerouslySetInnerHTML` — 3 occurrences

| Location | Source | Risk |
| --- | --- | --- |
| `panels/accounts/pages/Certificates.jsx:79` | `mammoth` output from a `.docx` | **High** — unsanitised, SEC-010 |
| `panels/accounts/pages/Certificates.jsx:1316` | same | **High** — SEC-010 |
| `panels/hr/components/Letters.jsx:1303` | `out.body` built from worker/NGO fields | **High** — stored XSS, SEC-002 |

`Letters.jsx` also injects the same body at `:1043` via `el.innerHTML` before
`html2canvas` rasterises it, so the payload fires even when the preview is
closed. An `esc()` helper exists at `Letters.jsx:88` but is applied to only a few
fields — `w.name`, `ngo.name`, `hrNameText` and `ngo.address` are interpolated
raw. A worker can set their own display name, so this is reachable by a
low-privilege user against an HR administrator.

### `innerHTML` / `document.write` — 14 occurrences

| Location | Assessment |
| --- | --- |
| `hr/components/Letters.jsx:1043` | **High** — see SEC-002 |
| `hr/components/GenerateQR.jsx:78` | **Medium** — unescaped `label` into a same-origin window, SEC-013 |
| `documentation/components/DiagramViewer.jsx:60` | Low — Mermaid output; set `securityLevel` explicitly |
| `documentation/components/DiagramViewer.jsx:67` | Low — `e.message` into `innerHTML`, SEC-016 |
| `hr/components/forms/PrintForms.jsx:22,24` | Low — serialises a React subtree (already escaped) |
| `accounts/pages/BankAudit.jsx:675`, `accounts/pages/Receipts.jsx:532` | Low — same pattern |
| `hr/components/GenerateQR.jsx:13,37` | None — clearing a node |

### Defences that already exist

- `event-head/pages/MonthlyPlanner.jsx:66` — a complete
  `escapeHtml` covering `& < > " '`, used at `:707-708`
- `accounts/services/pdfGenerator.js:282` — `sanitizeFileName` (filenames only)
- Chat attachments — a real MIME allow-list and 25 MB cap at
  `chatIdentity.js:116-145`, mirrored server-side

**New rule:** any new HTML injection point must be sanitised with DOMPurify
(already in the tree as a transitive dependency — add it as a direct one) and
covered by a lint rule.

## No Content-Security-Policy

`client/index.html` has no CSP meta tag, `vite.config.js` sets no
`server.headers`, and there is no CSP plugin. A policy would be the highest
leverage single mitigation for SEC-002, SEC-010, and SEC-013. See
[REVERSE-PROXY.md](REVERSE-PROXY.md) for a deployable policy.

`dompurify@3.4.11` resolves in `package-lock.json` only as a transitive
dependency of `jspdf` and is **never imported** — the vite chunk rule at
`vite.config.js:18` referencing it is misleading.

## Sensitive data in browser storage

| Key | Contents | Location |
| --- | --- | --- |
| `ucs_token`, `ucs_user` | JWT + user object | `api/auth.js:5-8` |
| `ucs_original_token` | **pre-impersonation super-admin token** | `api/auth.js:152-153` |
| `receipts_verified_data` | donor name, address, **PAN**, UPI ID, bank, mobile | `accounts/pages/Dashboard.jsx:207-225` — SEC-008 |
| `wa_agents` | WhatsApp agent session tokens | `panels/fro/pages/WhatsAppChat.jsx:76-83` |
| `wrk` (sessionStorage) | worker record incl. **Aadhaar**, bank/IFSC | `panels/hr/components/Workers.jsx:12-16` |
| `mydonors_form_state_<id>` | donor address, **PAN**, DOB, UPI transaction ID, amount, screenshot | `panels/fro/pages/MyDonors.jsx:757-764` |
| `admin_attendance_pin_*` | attendance PIN | `panels/super-admin/pages/AdminAttendance.jsx:53` |
| `receipt_template_settings` | receipt-design choices only — **no donor PII** | `accounts/pages/TemplateSettings.jsx:41,48` |

None of this is encrypted and all of it survives until logout. The logout handler
(`store.jsx:75-99`) calls `localStorage.clear()` but preserves `si_*` and `nc_*`
keys, so it is not a reliable wipe.

**Correction (2026-09-30, reviewed at `0ab8562a`):** the earlier claim that the
`wrk` key held Aadhaar and bank details is **stale**. `Workers.jsx:14-16` now
persists UI state only (search, page, status and role filters) — the persistence
pattern is unchanged, but no Aadhaar, bank, IFSC or salary is written to that
key. `receipt_template_settings` likewise holds no donor data. Two leaks not
previously listed are recorded above.

**Rule:** never persist Aadhaar, PAN, bank details, or session tokens to browser
storage. Keep them in memory for the life of the request.

## API layer

The primary wrapper is hand-rolled `fetch`, not axios
(`client/src/api/auth.js:33-90`): 120 s default timeout, `FormData` boundary
handled correctly (`:35-37`), bearer token attached fresh per call (`:38`).

There are two further independent clients that duplicate this logic and drift
from it:

- `panels/accounts/metropad/services/api.js:1-27` — axios with a **hardcoded
  production host** `https://api.beingsevak.org/api/metropad` and a 401 handler
  that removes the token but leaves the user object behind
- `panels/accounts/bill-reminder/api.js:25-39` — its own `request()` with **no
  401 handling at all**

Consolidate these onto the shared wrapper; three divergent clients is how the
error-handling and token-attachment inconsistencies in SEC-014 arise.

`client/src/lib/apiBase.js:2` reads `VITE_API_URL` with **no fallback** — the
production default was commented out at `:1`. Unset, requests go to
`undefined/<path>`. Keep a fallback so a misconfigured build fails loudly.

Error handling surfaces the raw server `err.message` in the UI and derives an
`e.routeMissing` flag from the `Content-Type` of a 404 (SEC-014).

## Environment variables

Only three `VITE_*` variables are read by client code:

| Variable | Read at |
| --- | --- |
| `VITE_API_URL` | `lib/apiBase.js:2`, `panels/accounts/bill-reminder/config.js:1` |
| `VITE_SOCKET_URL` | `lib/socket.js:7` |

`client/.env` (untracked, gitignored) additionally holds a real Supabase URL
and anon JWT (commented, lines 2-3) and plaintext `VITE_WHATSAPP_MASTER_*`
credentials (uncommented, lines 23-24). `VITE_` variables are inlined into the
public bundle, so any reference to those would publish an admin credential
(SEC-011). `client/.env.example` is clean and contains no secrets.

## Socket transport

`client/src/lib/socket.js:18` sends the token in the websocket handshake
(`auth: { token: getToken() }`) with `reconnectionAttempts: Infinity`. Ensure
`wss://` is enforced in production and that the server authenticates the
handshake before subscribing a socket to any channel.

## Uploads

Two patterns: `FormData` multipart, and `FileReader.readAsDataURL` → base64 in
a JSON body (`client/src/utils/usePasteImage.js:38-47`).

Beyond the chat path, uploads rely on the `accept=` attribute alone — a picker
hint, fully bypassable. Widest examples:
`fro/components/enhanced/MessageComposer.jsx:88`,
`event-head/pages/MediaManagement.jsx:997`. Some paths
(`fro/pages/MyDonors.jsx:2014`, `DonorDetail.jsx:376`) have no size check at all.

Base64 inflates by ~33% before JSON encoding against a 10 MB parser cap, so
pastes fail late and expensively (SEC-019).

## Deployment

The `deploy-frontend.yml` workflow was removed (no AWS deployment). The bundle is
built locally and copied to the web root by hand. Build-time `VITE_*` values
come from GitHub secrets when a workflow is reintroduced (SEC-011). The
pre-deploy greps for the retired chat mock and layout scripts are worth keeping.

**No security headers are set by the workflow or the bundle** — whatever the app
serves today is configured only on the host, outside version control (SEC-003).
