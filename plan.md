# Community Chat — Superadmin & Accounts Panels

Status: **built and verified, pending deploy**
Last updated: 2026-09-26

---

## 1. Summary

A WhatsApp-style chat in the CRM SPA, mounted as a nav page in **all 8 staff
panels**. One shared **Community** room plus **1:1 direct messages**.

- **Superadmin + Accounts** can read, post, attach, edit and delete.
- **Every other role** (HR, FRO, NGO admin, recruiter, event head, dev) can read
  the Community room only — no posting, no DMs, no uploads.

The model is a WhatsApp group where HR and FRO are **muted members**: they see
everything, they can say nothing.

Panels touched: `super-admin`, `accounts`, `hr`, `fro`, `recruiter`,
`event-head`, `ngo-admin`, `dev-panel`.

---

## 2. Access model

### 2.1 Final matrix

| Action | Superadmin | Accounts | HR / FRO / NGO admin / Recruiter / Event head / Dev |
|---|---|---|---|
| Read Community room | Yes | Yes | **Yes** |
| Post message | Yes | Yes | **No** — 403 |
| Upload attachment | Yes | Yes | **No** — 403 |
| Edit own message | Yes | Yes | **No** — 403 |
| Delete own message | Yes | Yes | **No** — 403 |
| **Delete anyone's message** | **Yes** | **No** | **No** — 403 |
| Open / create a DM | Yes | Yes | **No** — 403 |
| See that a DM exists | Yes | Yes | **No** — filtered / 404 |
| Search Community | Yes | Yes | Yes |
| Search DMs | Yes | Yes | **No** — 404 |
| Download others' attachments | Yes | Yes | Yes |
| Mark-as-read (own row only) | Yes | Yes | Yes |
| Desktop notification | Yes | Yes | **Yes** |

### 2.2 Two gates, not a role allow-list

An earlier draft gated every route with `authenticateRole('super_admin','accounts')`.
That is wrong for this design — it locks out the 6 read-only roles. The gates are
**role-based for writes, data-based for reads**.

```js
// backend/src/routes/chatRoutes.js
router.use(authenticate);                 // any logged-in staff identity

// READ — gate is participation, not role
router.get('/conversations', listConversations);
router.get('/conversations/:id/messages', listMessages);
router.get('/conversations/:id/search', searchMessages);
router.post('/conversations/:id/read', markRead);

// WRITE — gate is role AND participation
router.post('/conversations/:id/messages', chatWriter, sendMessage);
router.post('/conversations/direct',      chatWriter, openDirectMessage);
router.get('/people',                     chatWriter, listDmTargets);
router.patch('/messages/:id',             chatWriter, editMessage);
router.delete('/messages/:id',            chatWriter, deleteMessage);
```

```js
// backend/src/middleware/chatAccess.js
import { normalizeRole } from './authMiddleware.js';

export const CHAT_ROLES = new Set(['super_admin', 'accounts']);

// Write gate. Must mount AFTER `authenticate` so req.user is populated.
export const chatWriter = (req, res, next) =>
  CHAT_ROLES.has(normalizeRole(req.user.role))
    ? next()
    : res.status(403).json({ message: 'Only Super Admin and Accounts can post in chat.' });
```

Read authorization is purely data-driven: a `chat_participants` row must exist.
No row → **404, not 403**, so a caller cannot probe for a conversation's existence.

### 2.3 DM containment

A read-only role holds a Community participant row but must never reach DM data.
DM reads therefore need a **second** check on top of membership, enforced in three
independent places so one missed filter cannot leak a DM:

1. `GET /conversations` — drop `kind='direct'` rows when `!canPost`
2. `GET /conversations/:id/messages` — 404 if `kind='direct'` and caller is not a writer
3. `GET /conversations/:id/search` — scoped to the conversation ids the caller may read

`ensureChatSchema` **only ever seeds participants into `kind='group'` rooms**, so a
read-only role is structurally never a member of a DM.

### 2.4 The one "write" a read-only role performs

`POST /conversations/:id/read` sits behind `authenticate` only, because read-only
roles need unread badges. It writes `last_read_at` / `last_read_msg_id` on the
caller's **own** `chat_participants` row and cannot touch message content. This is
read state, not a content write.

---

## 3. Data model — `backend/migrations/151_chat.sql`

```sql
CREATE TABLE IF NOT EXISTS chat_conversations (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'group',   -- 'group' | 'direct'
  slug        TEXT UNIQUE NOT NULL,            -- 'community' | 'dm:<uidA>|<uidB>' (sorted)
  title       TEXT,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_archived BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS chat_participants (
  conversation_id   BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  uid               TEXT NOT NULL,        -- stable chat identity (see §4)
  subject_id        TEXT NOT NULL,        -- String(req.user.id) -> notification_log.worker_id
  role              TEXT NOT NULL,        -- 'super_admin' | 'accounts' | 'hr' | 'fro' | ...
  can_post          BOOLEAN NOT NULL DEFAULT false,
  display_name      TEXT NOT NULL,
  email             TEXT,
  ngo_id            TEXT,
  last_read_at      TIMESTAMPTZ,
  last_read_msg_id  BIGINT,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, uid)
);
CREATE INDEX IF NOT EXISTS idx_chat_participants_uid ON chat_participants (uid);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_uid      TEXT NOT NULL,
  sender_role     TEXT NOT NULL,
  sender_name     TEXT NOT NULL,
  body            TEXT,
  attachment_url  TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size BIGINT,
  client_id       TEXT,                   -- optimistic-UI reconciliation
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_has_content CHECK (
    (body IS NOT NULL AND length(body) > 0) OR attachment_url IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages (conversation_id, id DESC);
```

### Notes on specific columns

- **`uid`** — stable identity key. See §4 for why `req.user.id` is unusable.
- **`subject_id`** — exists solely to bridge to `notification_log.worker_id`, which
  the client filters on (`SuperAdminPanel.jsx:204`). For HR user Suresh this is
  `17` (his `users.id`), **not** `email:suresh@ufs.org`.
- **`can_post`** — stored so posting rights can be granted later without touching
  every row. Server-side it is **always** re-checked against `CHAT_ROLES`;
  `can_post` exists for the UI, `chatWriter` is the actual enforcement.
- **`client_id`** — matches the optimistic bubble to the server row on the 201 so
  the bubble keeps its position instead of jumping to the bottom.
- **No full-text search index.** Search uses `ILIKE` (see §6). Volumes are a few
  hundred messages/day, well inside an indexed range scan. Add a GIN
  `to_tsvector` index only if that changes.
- **The `CHECK` constraint** is the last-resort backstop for empty messages; the
  controller validates first and returns a friendly 400.

### Soft delete only

`DELETE` sets `deleted_at`; the row survives for audit and the client renders
"This message was deleted". There is no hard delete and no conversation deletion.

---

## 4. Identity resolution — `backend/src/services/chatIdentity.js`

The highest-risk part of the build. `req.user.id` alone is unusable: it is an `int`
for `users`-table logins, a `uuid` for `workers`-table logins, and `0` for the env
superadmin.

Four login paths sign different claims:

| Caller | Token claims | `uid` resolved | Why |
|---|---|---|---|
| Env superadmin (`authController.js:26`) | `{id:0, email, name}` | `email:admin@ufs.org` | no `login_id`, has email |
| `users` table (`:110`) | `{id:42, email, name}` | `email:anita@ufs.org` | users table |
| **`workers` table, accounts panel (`:82`)** | `{id:'9f3c…', login_id, role}` — **no name, no email** | `login:ufs.acc.priya` + DB backfill | **`login_id` wins** |
| `workers` table, other panels (`:363`) | `{id:'2a71…', login_id, name}` | `login:ufs.fro.vikram` | has `login_id` + name |

```js
import { normalizeRole } from '../middleware/authMiddleware.js';
import { getUserById } from '../models/userModel.js';
import { getWorkerById } from '../models/workerModel.js';

const cache = new Map();                 // uid -> { identity, expiresAt }
const TTL_MS = 5 * 60 * 1000;

export async function resolveChatIdentity(reqUser) {
  const role = normalizeRole(reqUser.role);
  let uid;
  let displayName = reqUser.name || null;
  let email = reqUser.email || null;

  if (reqUser.login_id)       uid = `login:${reqUser.login_id}`;
  else if (reqUser.email)     uid = `email:${String(reqUser.email).toLowerCase()}`;
  else                        uid = `id:${reqUser.id}`;

  const hit = cache.get(uid);
  if (hit && hit.expiresAt > Date.now()) return hit.identity;

  // The workers path used by the accounts panel signs NO name and NO email.
  if (!displayName || !email) {
    const row = await lookupById(reqUser.id);   // users first, then workers
    displayName = displayName || row?.name || 'Unknown';
    email      = email      || row?.email || null;
  }

  const identity = {
    uid,
    subjectId: String(reqUser.id),              // -> notification_log.worker_id
    role,
    canPost: role === 'super_admin' || role === 'accounts',
    displayName: displayName || 'Unknown',
    email: email || null,
    ngoId: reqUser.ngo_id ?? null,
  };

  cache.set(uid, { identity, expiresAt: Date.now() + TTL_MS });
  return identity;
}
```

The 5-minute TTL cache keeps message sends off Postgres.

---

## 5. Seeding — `backend/src/bootstrap/ensureChatSchema.js`

No migration runner exists in this repo; schema comes from hand-applied SQL plus
idempotent `src/bootstrap/ensure*.js` guards called at boot (`index.js:920-934`).
Ours registers there.

```js
export async function ensureChatSchema() {
  await db._pool.query(CHAT_DDL);        // the three CREATE TABLE IF NOT EXISTS + indexes

  await db.from('chat_conversations')
    .upsert({ kind: 'group', slug: 'community',
              title: 'Accounts Community', created_by: 'system' },
            { onConflict: 'slug', ignoreDuplicates: true });

  const staff = await db.from('users')
    .select('id, name, email, role, ngo_id').eq('is_active', true);

  const accountsWorkers = await db.from('workers')
    .select('id, name, email, login_id, role, ngo_id')
    .in('department', ['account', 'accounts', 'admin']).eq('is_active', true);

  const fieldWorkers = await db.from('workers')
    .select('id, name, email, login_id, role, ngo_id, department')
    .eq('is_active', true);

  await Promise.all([...staff, ...accountsWorkers, ...fieldWorkers]
    .map(p => upsertCommunityParticipant(p)));
}
```

| Source | Filter | `can_post` |
|---|---|---|
| `users` | `role IN ('super_admin','accounts')` AND `is_active` | `true` |
| `users` | all other roles, `is_active` | `false` |
| `workers` | `is_active`, `department IN ('account','accounts','admin')` | `true` |
| `workers` | `is_active`, all other departments | `false` |

**Self-healing:** a newly created accounts user is admitted on the next backend
restart. No migration, no manual step. Runs over a few dozen rows — negligible.

Resulting seed data:

```
chat_participants  (conversation_id = 1)
 uid                   │ subject_id │ role        │ can_post │ display_name
───────────────────────┼────────────┼─────────────┼──────────┼──────────────
 email:admin@ufs.org   │ 0          │ super_admin │ true     │ Super Admin
 login:ufs.acc.priya   │ 9f3c…uuid  │ accounts    │ true     │ Priya Nair
 email:anita@ufs.org   │ 42         │ accounts    │ true     │ Anita Desai
 email:suresh@ufs.org  │ 17         │ hr          │ false    │ Suresh Kumar
 login:ufs.fro.vikram  │ 2a71…uuid  │ fro         │ false    │ Vikram Patil
```

---

## 6. API — `backend/src/routes/chatRoutes.js`

Mounted at `/api/chat` in `index.js`. All routes `authenticate` first; write routes
additionally get `chatWriter`.

| Method | Path | Gate | Notes |
|---|---|---|---|
| GET | `/people` | writer | DM targets, `can_post = true` only. **403 for read-only roles** |
| GET | `/conversations` | member | DMs filtered out for non-writers |
| POST | `/conversations/direct` | writer | find-or-create by sorted slug, idempotent |
| GET | `/conversations/:id/messages` | member | cursor pagination `?before=<id>&limit=50` |
| POST | `/conversations/:id/messages` | writer | `multipart/form-data`, optional `file` + `body` |
| POST | `/conversations/:id/read` | member | upsert own `last_read_at` / `last_read_msg_id` |
| GET | `/conversations/:id/search` | member | `?q=`, scoped to readable conversation ids |
| PATCH | `/messages/:id` | writer + sender | edit is **always** sender-only |
| DELETE | `/messages/:id` | writer + (sender **or** superadmin **in a group room**) | soft delete |
| GET | `/unread-count` | member | total, for the nav badge |

### 6.1 Message validation

- Body trimmed, max **4000** chars
- Empty body **and** no attachment → 400
- Attachment: 25 MB cap, MIME allow-list (own copy, so chat uploads can never
  widen the global list at `index.js:274-281`)
- S3 bucket `chat-media`, `chat/` key prefix, via the existing `db.storage` helper
  (same shape as `index.js:289-294`)
- `express-rate-limit` is already a dependency (`backend/package.json`) but unused
  in the repo — apply a per-user send limit here

### 6.2 Superadmin moderation

```js
export const deleteMessage = async (req, res) => {
  const me = await resolveChatIdentity(req.user);
  const msg = await chatModel.getMessage(req.params.id);
  if (!msg) return res.status(404).json({ message: 'Message not found' });
  if (!(await chatModel.isParticipant(msg.conversation_id, me.uid))) {
    return res.status(404).json({ message: 'Message not found' });
  }

  const isModerator = me.role === 'super_admin';
  if (!isModerator && msg.sender_uid !== me.uid) {
    return res.status(403).json({ message: 'You can only delete your own messages' });
  }
  res.json(await chatModel.softDelete(msg.id));
};
```

- **`PATCH` (edit) stays sender-only.** A moderator can remove a message but cannot
  rewrite someone else's — an edited message must always carry its author's intent.
- **UI affordance:** `MessageBubble` shows delete on hover when
  `msg.sender_uid === myUid || (myRole === 'super_admin' && isGroupRoom)`. For a superadmin deleting
  someone else's message the client sends a different confirmation
  ("Delete this message posted by Priya Nair? This cannot be undone from her view."),
  because the author sees it vanish with no notice.

> **Resolved 2026-09-26 — moderation is Community-room only.** The escalation
> below was accepted in the original draft and is now rejected. A Super Admin in a
> DM is an ordinary participant: they can delete only their own messages there.
>
> ```js
> // community only
> const isModerator = me.role === 'super_admin' && convo.kind === 'group';
> ```
>
> Rationale: moderator rights are a broadcast-correction tool, not a supervisory
> one. Requiring a separate audited moderation workflow to justify the wider scope
> is not worth the privacy surface, and the ordinary chat UI never shows a
> superadmin a DM they are not party to, so nothing is lost. Applied identically in
> `deleteMessage`, in `MessageBubble.jsx` (the delete affordance is gated on
> `isGroup`), and in the mock, so the three cannot drift.

### 6.3 Search

`ILIKE '%q%'` on `body`, scoped to conversation ids the caller may read:

```js
const allowed = me.canPost
  ? allConversationIdsFor(me.uid)      // groups + DMs
  : groupConversationIdsFor(me.uid);  // groups only
```

The clamp is server-side, so a crafted `?conversationId=7` cannot reach a DM.

---

## 7. Realtime

### 7.1 Message delivery — no new socket infrastructure

Add the three tables to `REALTIME_TABLES` (`backend/src/config/db.js:78-84`). Do
**not** add them to `BULK_EMIT_TABLES` — per-message delivery is required, not
coalesced. The existing emitter broadcasts on insert and the existing
`useRealtime` hook consumes it.

```jsx
// client/src/hooks/useChatRealtime.js
useRealtime('chat_messages', {
  filter: `conversation_id=eq.${activeId}`,
  onInsert: (row) => {
    setMessages(prev => prev.some(m => m.id === row.id) ? prev : [...prev, normalise(row)]);
    if (row.sender_uid !== myUid) markRead(activeId, row.id);
  },
  enabled: !!activeId,
});
```

A second **unfiltered** subscription bumps the sidebar row's preview and unread
count for conversations that are not currently open:

```jsx
useRealtime('chat_messages', { onInsert: bumpConversationPreview });
```

### 7.2 Typing indicators — the only new socket code

`db:change` broadcasts persisted rows; typing is ephemeral, so it needs a real
socket event. `backend/src/socket.js` currently has no client→server handlers at all.

```js
io.on('connection', (socket) => {
  // …existing role:<role> / worker:<id> rooms…

  socket.on('chat:join', (conversationId) => socket.join(`chat:${conversationId}`));

  socket.on('chat:typing', ({ conversationId }) => {
    socket.to(`chat:${conversationId}`).emit('chat:typing', {
      name: socket.user.name, role: socket.user.role,
    });
  });
});
```

Plus an `isChatUserOnline(uid, conversationId)` helper mirroring the existing
in-process `workerSockets` presence map (`socket.js:10-22`) — carrying the same
documented single-process caveat (no Redis adapter; would break under PM2 cluster).

Client throttles to one emit per 2 s while typing, plus a stop event 3 s after the
last keystroke. Read-only roles never mount the composer, so they neither send nor
receive typing events.

---

## 8. Notifications — `backend/src/services/chatNotifier.js`

Reuses `notifyWorker` (`fcmService.js:81`), which always writes a
`notification_log` row even without an FCM token and additionally attempts a push if
one exists.

```js
export const fanOut = async (msg, sender) => {
  const others = await chatModel.getParticipants(msg.conversation_id);
  for (const p of others) {
    if (p.uid === sender.uid) continue;                          // not yourself
    if (isChatUserOnline(p.uid, msg.conversation_id)) continue;  // already looking
    notifyWorker(p.subject_id, msg.sender_name,
                 truncate(msg.body || 'Sent an attachment', 120),
                 'chat_message', msg.conversation_id);
  }
};
```

**No role filter** — the Community participant list already includes read-only
roles, so they are notified too (per the decision on 2026-09-26).

The `notification_log` row lands in the existing realtime chain that both panels
already run (`SuperAdminPanel.jsx:203-205`, `AccountsPanel.jsx:9-10`):

```jsx
useRealtime('notification_log', {
  filter: `worker_id=eq.${user?.id}`,
  onInsert: () => loadNotifications(),
});
// → unread.forEach(n => showDesktopNotification(n.title, n.body))
```

> **Accepted noise:** with 100+ field FROs on the Community participant list, a busy
> morning produces a burst of desktop notifications on field devices. If that proves
> noisy the fix is a per-participant mute column later — not worth building now.

---

## 9. Frontend

### 9.1 Shared feature directory

`client/src/components/chat/` — mounted by all 8 panels from the same SPA bundle.

| File | Purpose |
|---|---|
| `ChatWorkspace.jsx` | two-pane layout; derives capability from the logged-in user |
| `ConversationList.jsx` | room + DM rows, preview, unread pill, online dot |
| `MessageThread.jsx` | infinite scroll (IntersectionObserver sentinel), day dividers, IST timestamps |
| `MessageBubble.jsx` | own/other alignment, edited + deleted states, hover actions, moderator delete |
| `ChatComposer.jsx` | autosize textarea, Enter to send / Shift+Enter newline, paste-image, file picker, typing throttle |
| `ChatSearch.jsx` | inline search over the active conversation |
| `ChatBellBadge.jsx` | unread pill for the sidebar nav item |
| `ReadOnlyBanner.jsx` | replaces the composer for read-only roles |
| `AttachmentPreview.jsx` | image thumbnail vs download row, by MIME |
| `chat.css` | feature-scoped, following the `simScope.css` / `calendar.css` convention |

Supporting:
- `client/src/lib/chatApi.js` — wrappers over `api()` from `src/api/auth.js`, `_prefix: 'ucs'`
- `client/src/hooks/useChatRealtime.js` — wraps `useRealtime` for the 3 tables + `chat:typing`

`chat.css` is a new file rather than an addition to `client/src/index.css`, which is
already 286 KB.

### 9.2 Capability derivation

```jsx
// client/src/components/chat/ChatWorkspace.jsx
const { user } = useUcs();
const canPost = user.role === 'super_admin' || user.role === 'accounts';

{canPost ? <ChatComposer conversationId={activeId} /> : <ReadOnlyBanner />}
```

`canPost` mirrors the server gate. **The composer is replaced, not disabled** — a
greyed-out input invites misclick frustration. `chatApi.listDmTargets()` is only
reachable from inside the composer branch, so read-only roles never enumerate
who is DM-able.

### 9.3 Panel wiring — 4 different icon conventions

| Panel | NAV location | Icon convention |
|---|---|---|
| `SuperAdminPanel.jsx:34-54` | `NAV`, after `tickets` | `icon: GridFour` — `@phosphor-icons/react` |
| `AccountsPanel.jsx:112-117` | `NAV_BOTTOM` beside `tickets`; also append to `ALL_NAV:146` | `icon: <svg>…</svg>` inline JSX |
| `HRPanel.jsx:35-49` | `NAV` | `icon: Grid` component import |
| `FROPanel.jsx:121-127` | `NAV_BASE` | `Icon: LayoutDashboard` — **capital `I`** |
| `RecruiterPanel.jsx:19-24` | `NAV` | `icon: Grid` from `./icons` |
| `EventHeadPanel.jsx:34-51` | `NAV` + a `SECTIONS` group | `icon: Grid, section:'Reporting'` |
| `NgoAdminPanel.jsx:26-34` | `NAV` | `icon: 'dashboard'` **string key** + `ICONS` map entry |
| `DevPanel.jsx:14-26` | `NAV` | `icon: 'dashboard'` **string key** + `ICONS` map entry |

**No `App.jsx` change needed** — each panel owns its routes, and the outer
`ProtectedRoute` (`App.jsx:142-181`) already gates each panel path by role.

Per-panel page (8 small files, each just renders `<ChatWorkspace />`):
```
client/src/panels/{super-admin,accounts,hr,fro,recruiter,event-head,ngo-admin,dev-panel}/pages/Chat.jsx
```

### 9.4 UX details — flagged, not yet decided

Both are one-liners. Defaults shown; easy to flip.

1. **Nav label.** `Community` in all 8 panels. Originally `canPost ? 'Chat' :
   'Community'`, but two labels for one feature read as two features when you move
   between panels. `{ id: 'chat', label: 'Community' }`.
2. **Group header.** A WhatsApp group shows member avatars + count. Recommend
   mirroring it (`👥 24 members` + avatar stack) in `ThreadHeader` for
   `kind='group'`, because a wrong guess at "who is in this room" is the main way a
   broadcast chat causes an incident. Cheap insurance.

### 9.5 Rendering safety

Message bodies render as plain JSX text nodes — React escapes them, so no
sanitizer is needed and `<script>` in a message displays as text. Images use
`loading="lazy"` (the thread can hold 500+ bubbles after infinite scroll) and only
`image/*` MIME types render as `<img>`; everything else becomes a download link
with `rel="noopener noreferrer"`.

---

## 10. File inventory

### New — backend
```
backend/migrations/151_chat.sql
backend/src/bootstrap/ensureChatSchema.js
backend/src/middleware/chatAccess.js
backend/src/models/chatModel.js
backend/src/controllers/chatController.js
backend/src/routes/chatRoutes.js
backend/src/services/chatIdentity.js
backend/src/services/chatNotifier.js
backend/src/chat/chat.test.js
```

### New — frontend
```
client/src/lib/chatApi.js
client/src/hooks/useChatRealtime.js
client/src/components/chat/ChatWorkspace.jsx
client/src/components/chat/ConversationList.jsx
client/src/components/chat/MessageThread.jsx
client/src/components/chat/MessageBubble.jsx
client/src/components/chat/ChatComposer.jsx
client/src/components/chat/ChatSearch.jsx
client/src/components/chat/ChatBellBadge.jsx
client/src/components/chat/ReadOnlyBanner.jsx
client/src/components/chat/AttachmentPreview.jsx
client/src/components/chat/chat.css
client/src/panels/{super-admin,accounts,hr,fro,recruiter,event-head,ngo-admin,dev-panel}/pages/Chat.jsx
```

### Modified
```
backend/src/index.js       mount /api/chat + call ensureChatSchema() (near :920-934)
backend/src/socket.js      chat:join / chat:typing handlers + presence helpers
backend/src/config/db.js   +3 tables in REALTIME_TABLES (:78-84)
client/src/panels/super-admin/SuperAdminPanel.jsx    NAV + Route
client/src/panels/accounts/AccountsPanel.jsx        NAV_BOTTOM + ALL_NAV + Route
client/src/panels/hr/HRPanel.jsx                    NAV + Route
client/src/panels/fro/FROPanel.jsx                  NAV_BASE + Route
client/src/panels/recruiter/RecruiterPanel.jsx      NAV + Route
client/src/panels/event-head/EventHeadPanel.jsx    NAV + SECTIONS + Route
client/src/panels/ngo-admin/NgoAdminPanel.jsx      NAV + ICONS + Route
client/src/panels/dev-panel/DevPanel.jsx           NAV + ICONS + Route
```

---

## 11. Build order

| # | Deliverable | Verify |
|---|---|---|
| 1 | `151_chat.sql` + `ensureChatSchema.js` (seed room, `can_post`) | `SELECT * FROM chat_participants` |
| 2 | `chatAccess.js` + `chatIdentity.js` | unit-test all 4 login shapes |
| 3 | `chatModel.js` → `chatController.js` → `chatRoutes.js` (read + send) | curl with two tokens |
| 4 | `db.js` realtime registration | 2 browsers, no refresh |
| 5 | `socket.js` `chat:join` / `chat:typing` + presence | typing dot appears |
| 6 | Attachments, search, edit, soft-delete + moderation | curl + UI |
| 7 | `chatNotifier.js` | close the tab, expect a desktop toast |
| 8 | `components/chat/*` + `chat.css` | renders in both writer panels |
| 9 | 8 panel pages + nav + routes | click through all 8 panels |
| 10 | `chat.test.js` | `npm test` + `npm run build` |

---

## 12. Verification

### Automated
- `cd backend && npm test` — `src/chat/chat.test.js` in the `node --test` style of
  `aadhaar.test.js` (the only existing test; there is no test runner on the client)
- `cd client && npm run build` — **the only real frontend gate.** This repo has no
  ESLint, no Prettier and no typecheck config, so `vite build` is the compile check.

### Test cases
- HR / FRO can read the Community room → 200
- HR / FRO get 403 on `POST /messages`, `POST /conversations/direct`, `GET /people`
- HR never sees a DM in `GET /conversations` (group rows only)
- HR gets **404** (not 403) opening a DM's messages directly
- A non-participant gets 404 on any conversation
- Writer roundtrip: send → receive
- Superadmin can delete another user's message → 200
- Accounts cannot delete another user's message → 403
- Accounts cannot edit another user's message → 403 (edit stays sender-only)
- Mark-read clears the unread count
- Unread count excludes the caller's own messages

### Manual
Two browsers, one superadmin + one accounts: message appears in both without
refresh. Third browser as HR: sees the room, no composer, no DM. Close the tab and
confirm a desktop notification. Attachment round-trips. DM is invisible to HR.

---

## 13. Decisions log

| Date | Decision |
|---|---|
| 2026-09-26 | Group room + 1:1 DMs (not channels) |
| 2026-09-26 | Nav page in every panel (not a floating widget) |
| 2026-09-26 | Real-time, attachments, search, edit/delete, closed-tab notifications |
| 2026-09-26 | All other roles get **read-only** access to the Community room |
| 2026-09-26 | DMs restricted to superadmin + accounts; invisible to read-only roles |
| 2026-09-26 | **Superadmin moderates all** — can delete any message; Accounts own-messages-only. Edit stays sender-only for everyone |
| 2026-09-26 | Read-only roles **do** get desktop notifications |
| 2026-09-26 | Nav item labelled **Community** in all 8 panels (one name, not role-dependent) |
| 2026-09-26 | Moderation scoped to the Community room — superadmin gets no special delete in a DM |

## 14. Open items

1. **Group header member avatars** — recommended, not built (§9.4).
2. **DM moderation scope** — superadmin can currently delete inside private DMs.
   Approved, flagged as a privacy escalation (§6.2).
3. **Message retention** — no cleanup policy; `chat_messages` grows unbounded. Fine
   at expected volume, but a retention job is worth adding eventually.
4. **Named group rooms beyond the seeded one** — deliberately out of scope. The
   `kind='group'` + `slug` schema already supports it, so adding channels later is
   schema-free.

### Resolved

- **Nav label** — `Community` everywhere, decided 2026-09-26. One screen, one name.
- **DM moderation scope** — Community room only, decided 2026-09-26 (§6.2).
