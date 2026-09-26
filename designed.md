# UCS Community Chat — Professional UI/UX Design Specification

**Version:** 1.0  
**Status:** Design and implementation specification  
**Scope:** Shared chat experience across all eight UCS staff panels  
**Reference:** Approved Community Chat feature plan, 26 September 2026

> This is a UI/UX implementation specification, not a claim that the application has been built or tested. Follow the acceptance checklist and run browser tests before release.

## 1. Product and permission rules

One shared **Community** room is visible to authenticated staff in Super Admin, Accounts, HR, FRO, Recruiter, Event Head, NGO Admin and Dev panels. Only Super Admin and Accounts can post or use direct messages (DMs). All other roles can read and search Community, download its attachments, mark it read and receive notifications, but cannot post, upload, edit, delete, open DMs or enumerate DM targets.

| Capability | Super Admin | Accounts | Other six roles |
|---|---|---|---|
| Read/search Community | Yes | Yes | Yes |
| Send message / attachment | Yes | Yes | No |
| Open/create/read/search DM | Yes, participant access applies | Yes, participant access applies | No |
| Edit own message | Yes | Yes | No |
| Delete own message | Yes | Yes | No |
| Delete another user's message | Yes, per approved moderation scope | No | No |
| Download accessible attachments | Yes | Yes | Community only |
| Unread badge / desktop notification | Yes | Yes | Yes |

**Security invariant:** UI hiding is not authorization. Every conversation read requires server-verified membership. Read-only roles must never receive DM metadata, message bodies, search hits, notifications containing DM content, or DM target lists. A forbidden DM lookup returns 404; forbidden write returns 403. The approved plan permits Super Admin to delete messages in a DM between other Accounts users; implement this moderation operation server-side without exposing the DM thread to a nonparticipant in the ordinary chat UI. If that moderation workflow is not separately implemented, do not imply that the Super Admin can browse those private DMs.

## 2. Design direction and tokens

Create a calm, professional CRM interface: dark navy global navigation, light neutral workspace, crisp blue accents, white surfaces, subtle borders, readable typography, restrained motion. The chat should feel native to UCS rather than a separate consumer messenger.

| Token | Value |
|---|---|
| `--chat-navy` | `#10263F` |
| `--chat-navy-hover` | `#1B3B60` |
| `--chat-primary` | `#2563EB` |
| `--chat-primary-hover` | `#1D4ED8` |
| `--chat-canvas` | `#F4F7FB` |
| `--chat-surface` | `#FFFFFF` |
| `--chat-text` | `#172B4D` |
| `--chat-muted` | `#64748B` |
| `--chat-border` | `#E2E8F0` |
| `--chat-own-bubble` | `#E7F0FF` |
| `--chat-other-bubble` | `#F1F5F9` |
| `--chat-success` | `#16A34A` |
| `--chat-danger` | `#DC2626` |
| `--chat-focus` | `#2563EB` |
| Font | Existing UCS font, fallback `Inter, system-ui, sans-serif` |
| Base / small text | 14px / 12px; body line-height 1.5 |
| Radius | 8px controls, 12px cards, 16px large surfaces |
| Spacing scale | 4, 8, 12, 16, 20, 24, 32px |
| Minimum interactive target | 44 × 44px |

Use consistent iconography with the host panel's icon system. Never mix emoji and icons as primary controls. Use initials avatars when profile images are absent; do not show broken-image icons.

## 3. Information architecture and routes

- Super Admin: `/sa/chat`; Accounts: `/accounts/chat`.
- Add one **Community** navigation item to each of the eight existing panel nav systems. Preserve the host panel's routing and icon conventions; do not change `App.jsx` solely for chat.
- Label the nav item **Community** in all eight panels, including Super Admin and Accounts. One name for one feature; the room is the product, and a role-dependent label made the same screen look like two different features across the app. Role capability is communicated by the composer and read-only banner inside the screen, not by the tab name.
- Shared `ChatWorkspace` derives capabilities from authenticated identity; do not duplicate the workspace across panels.
- Default route opens Community. Writers may select a DM. Read-only roles see Community only.
- Preserve the selected conversation in a supported route/query state if feasible; validate it server-side on reload. Never trust a client-provided conversation ID.

## 4. Screen inventory

### Screen 01 — Super Admin / Accounts: Community desktop

**Frame:** global sidebar | chat conversation rail | active thread. Header stays fixed; only list and message history scroll independently.

```text
┌───────────────┬────────────────────────────┬─────────────────────────────────────────────┐
│ UCS sidebar   │ Chat                       │ [Group avatar] Community       [Search] [⋯]│
│               │ Search conversations       │ 24 members · Shared staff room             │
│ Dashboard     │ [Community] [Direct]       ├─────────────────────────────────────────────┤
│ ...           │                            │                                             │
│ Chat      12  │ ● Community            12  │  Amit (Super Admin)   10:15 AM             │
│               │   Updated guidelines...    │  ┌──────────────────────────────┐           │
│               │                            │  │ Message + PDF attachment     │           │
│               │ ● Priya                 2  │  └──────────────────────────────┘           │
│               │   Thanks for sharing       │                                             │
│               │                            │              ┌──────────────────────────┐ │
│               │ ● Rahul                    │              │ Own message         ✓✓ │ │
│               │   Monthly report.xlsx      │              └──────────────────────────┘ │
│               │                            ├─────────────────────────────────────────────┤
│ Account       │                            │ [Attach] [Type a message…       ] [Send]   │
└───────────────┴────────────────────────────┴─────────────────────────────────────────────┘
```

**Behavior:** Conversation rail displays Community first, then accessible DMs sorted by latest activity. Row contains avatar, display name, one-line preview, local timestamp and unread count. The selected row has an unmistakable selected state. Community header shows participant count and accessible member information; never imply that only writers can read the room. The message thread shows sender name and role for group messages, day separators, attachments, edited state, deleted placeholder and IST timestamps. Own messages align right; others align left. Composer is pinned at the bottom of the thread, not the viewport.

### Screen 02 — Accounts: Community desktop

Use the same shared workspace and spacing as Screen 01 within the Accounts shell. Accounts can post and use DMs, edit/delete only their own messages, and **must not** see a moderation action on other users' messages. Keep panel-specific navigation and account identity visible in the host shell.

### Screen 03 — Read-only Community desktop (HR / FRO / Recruiter / Event Head / NGO Admin / Dev)

Show Community only. Do not render the Direct tab, DM rows, new-message button, file picker, typing indicator controls, emoji button, message action menu for writing, or composer. Replace the composer region with a compact persistent information banner:

> Read-only community · Only Super Admin and Accounts can post messages.

The banner is informational, not a disabled text field. Keep Community search, attachment downloads, member count, unread state and notifications. The room must remain readable on narrow screens; do not reserve empty space for hidden DM controls.

### Screen 04 — 1:1 direct message (writers only)

Header: recipient avatar, name, role, online status when known, search and more menu. Conversation rail indicates selected DM. Message bubbles omit repeated sender names where obvious but preserve timestamps, attachments and edit/delete states. Starting a DM uses an authenticated, writer-only people picker; only eligible Super Admin and Accounts users appear. Show an empty conversation prompt before the first message. Read-only roles never receive or render this screen.

### Screen 05 — New DM / people picker

Open from **New message**. Dialog max-width 480px, max-height `min(640px, 85dvh)`. Focus search on open; list eligible people with avatar, full name, role and online status. Search filters the returned list; loading, no-results and API-error states are explicit. Clicking a person finds/creates the DM and opens it. Close via X/Escape; restore focus to the trigger. Do not show in read-only panels.

### Screen 06 — Attachment selection and preview

Attach control opens a native file picker; pasted images also enter the same preview flow. Show thumbnail for images and a typed file card for other allowed MIME types. Preview includes filename, formatted size, remove button and optional caption. Enforce 25 MB maximum and server-approved MIME allow-list; show inline errors for unsupported or oversized files. During upload show progress or an indeterminate uploading state; disable duplicate submit but preserve draft. On failure show Retry and Remove. Never display a broken image as the fallback.

### Screen 07 — Message actions and moderation

On hover, keyboard focus or touch long-press / explicit more button, show an anchored menu without clipping. Own message: Edit, Delete, Copy text (as applicable). Other user's message: Super Admin may see Delete; Accounts may not. Edit opens an inline editor with Save and Cancel; original text remains until successful save. Delete opens a confirmation dialog; soft-deleted messages render **This message was deleted** with no attachment download. For another author's message, explicitly identify the author in the Super Admin confirmation. Do not offer editing someone else's text.

### Screen 08 — Search within accessible conversation

Search icon reveals an inline search panel/drawer; search is scoped to the active, server-authorized conversation. Debounce input ~300ms; show result count, highlighted matching text, sender and timestamp. Clicking a result navigates to and visibly highlights its message, loading older pages if needed. Empty query shows instructions; no matches shows a friendly empty state. Read-only roles search Community only. Clear button and Escape close search without destroying thread scroll position.

### Screen 09 — Notifications and unread badges

Global nav shows total unread conversations/messages per approved API semantics; conversation rows show their own unread count. Open thread marks only that user's participant row as read. New messages update previews and unread state without refresh. Desktop notifications are available to all eight roles for accessible Community messages; writers also receive notifications for their own accessible DMs. Never notify the sender about their own message. Respect browser notification permission and avoid duplicate alerts when the thread is already active. Clicking a notification opens the authorized thread.

### Screen 10 — Mobile / compact layout

At widths below 768px use a single-pane pattern: conversation list **or** thread, not two squeezed columns. Opening a thread replaces the list with a back button; returning restores list scroll and search state. Header and composer/read-only banner remain visible with keyboard open. Attachment preview and menus use a bottom sheet or viewport-contained dialog. No horizontal page scrolling.

## 5. Responsive layout contract

| Viewport | Layout |
|---|---|
| ≥1440px | Host sidebar + 320px chat rail + flexible thread |
| 1024–1439px | Host sidebar + 280–304px rail + flexible thread |
| 768–1023px | Host shell as provided + 260px rail + thread; collapse optional detail panel |
| <768px | Single pane; list/thread navigation |
| <400px | Compact paddings 12px, full-width bubbles up to 88%, icon labels via accessible names |

Workspace width: `min(100%, available host content width)`; height: `calc(100dvh - host header/toolbar offsets)` with a sensible minimum only when viewport allows. Do **not** hard-code `100vh` inside a panel that already has a header. Use `min-height: 0` on nested flex/grid children and `min-width: 0` on rail/thread; otherwise overflow and clipping occur. Message area alone gets `overflow-y: auto`; conversation list scrolls independently. Keep composer inside the thread grid row. Use `overflow-wrap: anywhere` for URLs and long filenames; preserve whitespace/newlines in messages. Do not force `overflow: hidden` on menus/dialogs; render overlays in a portal or position them against viewport boundaries.

Suggested grid:

```css
.chat-workspace { display:grid; grid-template-columns:minmax(260px, 304px) minmax(0, 1fr); min-width:0; min-height:0; height:100%; background:var(--chat-surface); }
.chat-rail { display:grid; grid-template-rows:auto auto minmax(0,1fr); min-width:0; min-height:0; border-right:1px solid var(--chat-border); }
.chat-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; }
.chat-thread { display:grid; grid-template-rows:auto minmax(0,1fr) auto; min-width:0; min-height:0; }
.chat-messages { min-height:0; min-width:0; overflow-y:auto; overscroll-behavior:contain; }
.chat-bubble { max-width:min(72%, 620px); overflow-wrap:anywhere; white-space:pre-wrap; }
@media(max-width:767px) { .chat-workspace { display:block; } .chat-rail,.chat-thread { height:100%; } .chat-workspace[data-view="list"] .chat-thread,.chat-workspace[data-view="thread"] .chat-rail { display:none; } .chat-bubble { max-width:88%; } }
```

Use feature-scoped `.chat-*` selectors in `client/src/components/chat/chat.css`. Avoid broad `button`, `input`, `.card`, `.header` or `body` overrides that could break other panels.

## 6. Component behavior and interaction states

| Component | Required states |
|---|---|
| Workspace | loading, ready, error, retry, unauthorized |
| Conversation list | loading skeleton, populated, empty DM list, search no results, unread, selected |
| Thread | initial loading, empty, messages, loading older, end of history, failed fetch |
| Bubble | sending, sent, failed/retry, edited, deleted, attachment loading/error |
| Composer | idle, multiline, attachment selected, uploading, send disabled, validation error |
| People picker | loading, results, no results, error |
| Search | idle, searching, results, no results, error |
| Notification | permission allowed/denied, unread, read, click navigation |

**Composer:** Enter sends; Shift+Enter inserts newline. On touch devices, use an explicit Send button. Send is disabled for whitespace-only content without an attachment. Max 4,000 characters; display a counter near the limit. Autosize between approximately 1 and 5 lines, then scroll internally. Preserve draft per conversation while switching threads. Optimistic messages use `client_id` for reconciliation; do not duplicate when realtime and HTTP responses arrive in either order. On send failure retain content and show Retry. Throttle typing emits; never show a typing indicator for read-only roles.

**History:** Fetch 50 messages per cursor page. Load older messages via top sentinel; preserve scroll anchor when prepending. Auto-scroll on a new message only if the user is near the bottom; otherwise show a **New messages** jump pill. Use local IST time consistently and include full date in accessible tooltip/label. Avoid duplicate day separators.

**Accessibility:** Semantic buttons, visible focus ring, ARIA labels for icon-only actions, `aria-live="polite"` for new-message status (avoid reading the entire thread), focus trapping in dialogs, Escape close, keyboard-operable menus, sufficient contrast and reduced-motion support. Announce upload errors. Never rely on color alone for unread/online status.

## 7. No-glitch implementation checklist

- [ ] Chat is contained within each host panel; no second global sidebar, duplicated header or nested viewport scrollbar.
- [ ] No horizontal overflow at 320, 375, 390, 768, 1024, 1366 and 1920px.
- [ ] Browser zoom at 125%, 150% and 200% retains readable controls and reachable actions.
- [ ] Long names, URLs, 4,000-character messages and filenames wrap without stretching columns.
- [ ] Composer and read-only banner do not overlap messages, mobile browser chrome or on-screen keyboard.
- [ ] Menus, tooltips, dialogs and attachment previews remain inside the viewport and above the chat layer.
- [ ] No layout jump when messages arrive, older pages load, image dimensions resolve or unread badges change.
- [ ] Scroll position remains stable when loading older messages or returning from a mobile thread.
- [ ] Rapid sends and realtime echoes produce exactly one bubble per `client_id`.
- [ ] Failed send/upload offers retry without silently losing the draft.
- [ ] Empty, loading, error, offline and unauthorized states never render blank panels.
- [ ] No inaccessible icon-only actions; keyboard and touch alternatives work.
- [ ] Read-only users have no composer, DM tab, people picker or write actions, including via deep links.
- [ ] Accounts cannot edit/delete another author's message; Super Admin delete uses confirmation.
- [ ] Deleted messages cannot reveal old body or attachment through the UI.
- [ ] Search, downloads and notifications respect conversation membership.
- [ ] Unread badges clear only for the currently authenticated user's read state.
- [ ] Browser notification permission denial does not break in-app chat.
- [ ] Verify light theme and any existing panel theme; no global CSS collisions.

## 8. Suggested component map

```text
client/src/components/chat/
  ChatWorkspace.jsx
  ConversationList.jsx
  MessageThread.jsx
  MessageBubble.jsx
  ChatComposer.jsx
  ChatSearch.jsx
  ChatBellBadge.jsx
  ReadOnlyBanner.jsx
  AttachmentPreview.jsx
  chat.css
client/src/lib/chatApi.js
client/src/hooks/useChatRealtime.js
client/src/panels/{super-admin,accounts,hr,fro,recruiter,event-head,ngo-admin,dev-panel}/pages/Chat.jsx
```

Reuse existing UCS `Avatar`, toast, authentication API, and realtime conventions. The eight panel pages should be thin wrappers around the shared workspace. The backend remains responsible for membership, writer role checks, sender-only edit, moderator delete, file validation and read state.

## 9. Release acceptance walkthrough

1. Sign in as Super Admin and Accounts in separate browsers; send a Community message and verify live arrival, preview, unread badge and mark-read behavior.
2. Send a DM between eligible users; verify it is not listed, searchable or accessible to HR/FRO or a nonparticipant.
3. Sign in as each of the six read-only roles; verify Community messages, search, downloads and notification, and verify complete absence of composer and DM controls.
4. Verify API 403 for read-only writes and 404 for forbidden DM reads, independent of UI.
5. Edit and soft-delete own messages; verify Accounts cannot act on others' messages and Super Admin moderation uses confirmation.
6. Test image/file upload, 25 MB rejection, MIME rejection, paste image, failure/retry and deleted attachment rendering.
7. Test long history, cursor pagination, live updates, typing, reconnect, duplicate event reconciliation and offline state.
8. Test responsive sizes, mobile keyboard, keyboard navigation, screen reader labels and browser zoom against the no-glitch checklist.
9. Run `cd client && npm run build` and backend tests including the chat authorization tests; fix failures before release.

**Design completion criterion:** Every screen has defined loading, empty, error, permission and responsive behavior; every visible action maps to a supported API/capability; no read-only user is shown a misleading disabled composer; and all layout/interaction checks above pass in the actual UCS application.
