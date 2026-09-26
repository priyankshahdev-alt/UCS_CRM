/**
 * In-memory stand-in for `backend/src/routes/chatRoutes.js`.
 *
 * TEMPORARY SCAFFOLD — delete this file, and the `CHAT_MOCK` branch in
 * chatApi.js, once `/api/chat` is mounted. It exists so every state in
 * designed.md §6 (loading, empty, error, retry, read-only, forbidden) can be
 * seen without a running chat backend.
 *
 * The logged-in staff member is a real user with a real database id, while the
 * seeded world is fictional. So the mock maps the viewer onto the persona with a
 * matching role for membership and moderation decisions, but keeps the viewer's
 * real uid on anything they send — otherwise their own messages would render on
 * the wrong side of the thread.
 *
 * The contract it mirrors: cursor pagination, `client_id` echo for optimistic
 * reconciliation, 403 for read-only writers, 404 for DM lookups the viewer may
 * not have, sender-only edit, and sender-or-moderator delete.
 */

const NOW = Date.now()
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const iso = (ms) => new Date(ms).toISOString()

let seq = 1000
const nid = () => seq++

const PEOPLE = [
  { id: 'u-sa', name: 'Aarav Mehta', role: 'super_admin' },
  { id: 'u-acc', name: 'Priya Nair', role: 'accounts' },
  { id: 'u-hr', name: 'Sneha Iyer', role: 'hr' },
  { id: 'u-fro', name: 'Vikram Patil', role: 'fro' },
  { id: 'u-rec', name: 'Rohan Desai', role: 'recruiter' },
  { id: 'u-evt', name: 'Kavya Reddy', role: 'event_head' },
  { id: 'u-adm', name: 'Ananya Sharma', role: 'admin' },
  { id: 'u-dev', name: 'Karan Malhotra', role: 'developers' },
]
const person = (id) => PEOPLE.find((p) => p.id === id)

/**
 * Split the viewer's identity into the two things the mock needs:
 *  - `uid`   the real id, stamped on anything the viewer sends
 *  - `as`    the seeded persona, used for membership and role checks
 */
function viewer(me) {
  const persona = PEOPLE.find((p) => p.role === me.role) || PEOPLE[0]
  return {
    uid: me.uid,
    as: persona.id,
    role: me.role,
    canPost: !!me.canPost,
    canModerate: !!me.canModerate,
  }
}

const isImage = (mime) => typeof mime === 'string' && mime.startsWith('image/')

// A local placeholder so image attachments render with no network.
const PIXEL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300">' +
      '<rect width="480" height="300" fill="#E2E8F0"/>' +
      '<text x="240" y="155" font-family="system-ui" font-size="18" fill="#64748B" text-anchor="middle">attachment</text>' +
      '</svg>'
  )

function msg(o) {
  return {
    id: o.id,
    conversation_id: o.convo,
    client_id: o.clientId || null,
    sender_uid: o.sender,
    sender_name: person(o.sender)?.name || 'UCS Staff',
    sender_role: person(o.sender)?.role || '',
    body: o.body || '',
    created_at: iso(o.at),
    edited_at: o.editedAt ? iso(o.editedAt) : null,
    deleted_at: o.deletedAt ? iso(o.deletedAt) : null,
    attachment: o.attachment || null,
    pending: false,
    failed: false,
  }
}

const SEED = [
  {
    convo: 'community',
    sender: 'u-sa',
    at: NOW - 3 * DAY - 40 * MIN,
    body: 'Good morning everyone. The attendance sync for the Pune station finished overnight — all 42 records landed cleanly. Shout here if anything looks off.',
  },
  {
    convo: 'community',
    sender: 'u-acc',
    at: NOW - 3 * DAY - 22 * MIN,
    body: 'Checked the ledger export against yesterday’s file. Totals match. No action needed.',
  },
  {
    convo: 'community',
    sender: 'u-fro',
    at: NOW - 3 * DAY - 12 * MIN,
    body: 'Station 14 is showing a duplicate donor row. I have paused FRO updates there until NGO Admin confirms which record is authoritative.',
  },
  {
    convo: 'community',
    sender: 'u-adm',
    at: NOW - 2 * DAY - 5 * HOUR,
    body: 'Confirmed — the second row was a test entry from April. Marked it inactive. You can resume Station 14 whenever you like.',
  },
  {
    convo: 'community',
    sender: 'u-fro',
    at: NOW - 2 * DAY - 4 * HOUR,
    body: 'Resuming now. Thanks for the quick turnaround.',
  },
  {
    convo: 'community',
    sender: 'u-sa',
    at: NOW - 1 * DAY - 3 * HOUR,
    body: 'Reminder: the mid-month payroll cut-off is tomorrow at 6 PM. Anything submitted after that rolls to next month.',
    attachment: {
      id: 'att-1',
      name: 'payroll-cutoff.png',
      mime: 'image/png',
      size: 184320,
      url: PIXEL,
    },
  },
  {
    convo: 'community',
    sender: 'u-acc',
    at: NOW - 1 * DAY - 2 * HOUR,
    body: 'Payslip template for the new field staff is attached. Please use this one going forward.',
    attachment: {
      id: 'att-2',
      name: 'payslip-template.pdf',
      mime: 'application/pdf',
      size: 942080,
      url: '#',
    },
  },
  {
    convo: 'community',
    sender: 'u-evt',
    at: NOW - DAY - 6 * HOUR,
    body: 'Volunteer orientation on Saturday has moved to Hall B. Same date, 9:30 AM start.',
  },
  {
    convo: 'community',
    sender: 'u-hr',
    at: NOW - DAY - 3 * HOUR,
    body: 'Three leave requests are still pending approval from the event heads. Could someone review today?',
  },
  {
    convo: 'community',
    sender: 'u-rec',
    at: NOW - DAY - 95 * MIN,
    body: 'Cleared nine resumes for the field ops drive. Shortlisting sheet is in the Recruiter panel.',
  },
  {
    convo: 'community',
    sender: 'u-dev',
    at: NOW - 6 * HOUR,
    body: 'Deployed the token-refresh fix. Long-lived sessions should no longer drop out on idle machines.',
  },
  {
    convo: 'community',
    sender: 'u-sa',
    at: NOW - 5 * HOUR,
    body: 'That explains a few of the logout reports I was chasing. Nice one.',
  },
  {
    convo: 'community',
    sender: 'u-acc',
    at: NOW - 3 * HOUR,
    body: 'Payroll cut-off reminder: submissions close tomorrow at 6 PM.',
    deletedAt: NOW - 2 * HOUR,
  },
  {
    convo: 'community',
    sender: 'u-fro',
    at: NOW - 52 * MIN,
    body: 'Station 09 tablet is on 4G again, not the office WiFi. The earlier drops were network, not the app.',
  },
]

// Backfill history so cursor pagination and infinite scroll have something to
// page through, with real timestamps so the day separators render properly.
for (let i = 60; i >= 1; i--) {
  const who = ['u-hr', 'u-fro', 'u-acc', 'u-rec', 'u-evt', 'u-adm'][i % 6]
  SEED.push({
    convo: 'community',
    sender: who,
    at: NOW - (4 * DAY + i * 90 * MIN),
    body: `Archive note ${i}: weekly reconciliation for the Nagpur cluster logged ${
      3 + (i % 7)
    } adjustments, all within tolerance.`,
  })
}

const DM_SEED = [
  {
    convo: 'dm-acc',
    sender: 'u-acc',
    at: NOW - 2 * HOUR,
    body: 'The donor receipt you asked about — ledger page attached. Total is 12,400.',
    attachment: {
      id: 'att-3',
      name: 'ledger-page.jpg',
      mime: 'image/jpeg',
      size: 245760,
      url: PIXEL,
    },
  },
  {
    convo: 'dm-acc',
    sender: 'u-sa',
    at: NOW - 105 * MIN,
    body: 'Got it, thanks. That reconciles with the bank statement.',
  },
  {
    convo: 'dm-acc',
    sender: 'u-acc',
    at: NOW - 100 * MIN,
    body: 'One more thing — the salary advance for Ramesh needs your sign-off before Friday.',
  },
  {
    convo: 'dm-acc',
    sender: 'u-sa',
    at: NOW - 98 * MIN,
    body: 'Approved on my side. Accounts can release it after 10 AM tomorrow.',
  },
  {
    convo: 'dm-hr',
    sender: 'u-hr',
    at: NOW - 3 * DAY,
    body: 'Do you have the updated leave policy document? Mine is the old 2024 revision.',
  },
  {
    convo: 'dm-hr',
    sender: 'u-sa',
    at: NOW - 3 * DAY + 30 * MIN,
    body: 'Sending it across now.',
  },
]

const state = {
  conversations: [
    {
      id: 'community',
      kind: 'group',
      title: 'Community',
      member_count: PEOPLE.length,
      member_ids: PEOPLE.map((p) => p.id),
    },
    {
      id: 'dm-acc',
      kind: 'direct',
      title: 'Priya Nair',
      member_ids: ['u-sa', 'u-acc'],
    },
    {
      id: 'dm-hr',
      kind: 'direct',
      title: 'Sneha Iyer',
      member_ids: ['u-sa', 'u-hr'],
    },
  ],
  messages: [
    ...SEED.map((s) => msg({ ...s, id: nid() })),
    ...DM_SEED.map((s) => msg({ ...s, id: nid() })),
  ],
  read: {},
}

// ---------------------------------------------------------------------------
// Tiny event bus so realtime and typing behave like the real socket layer.
// ---------------------------------------------------------------------------
const listeners = new Set()
function emit(evt) {
  listeners.forEach((fn) => {
    try {
      fn(evt)
    } catch {
      /* one broken subscriber must not break the rest */
    }
  })
}

const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms))

const err = (status, message) => {
  const e = new Error(message)
  e.status = status
  return e
}

function visibleConversations(v) {
  const mine = state.conversations.filter((c) => c.member_ids.includes(v.as))
  // Read-only roles never see DMs — the server filters them out entirely.
  return v.canPost ? mine : mine.filter((c) => c.kind === 'group')
}

function findConvo(convoId, v) {
  const c = state.conversations.find((x) => x.id === convoId)
  if (!c) throw err(404, 'Conversation not found')
  if (!c.member_ids.includes(v.as)) throw err(404, 'Conversation not found')
  if (c.kind === 'direct' && !v.canPost) {
    throw err(403, 'You do not have access to direct messages')
  }
  return c
}

function convoSummary(c, v) {
  const list = state.messages
    .filter((m) => m.conversation_id === c.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const last = list[list.length - 1] || null
  const cursor = state.read[`${v.uid}:${c.id}`]
  const isUnread = (m) =>
    m.sender_uid !== v.uid && (!cursor || new Date(m.created_at) > new Date(cursor))
  const preview = last
    ? last.deleted_at
      ? 'This message was deleted'
      : last.attachment && !last.body
        ? last.attachment.name
        : last.body
    : ''
  return {
    ...c,
    last_message: last
      ? {
          id: last.id,
          sender_name: last.sender_name,
          body: preview,
          created_at: last.created_at,
          deleted: !!last.deleted_at,
        }
      : null,
    unread_count: list.filter(isUnread).length,
    last_read_at: cursor || null,
  }
}

export const mockChatApi = {
  __subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  async listConversations(me) {
    await delay()
    const v = viewer(me)
    return visibleConversations(v).map((c) => convoSummary(c, v))
  },

  async getUnreadCount(me) {
    await delay(80)
    const v = viewer(me)
    return visibleConversations(v).reduce((n, c) => n + convoSummary(c, v).unread_count, 0)
  },

  async getMessages(me, convoId, { before, limit = 50 } = {}) {
    await delay()
    const v = viewer(me)
    findConvo(convoId, v)

    let list = state.messages
      .filter((m) => m.conversation_id === convoId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    if (before) {
      const i = list.findIndex((m) => m.id === Number(before))
      if (i >= 0) list = list.slice(0, i)
    }
    const hasMore = list.length > limit
    const page = list.slice(-limit)
    return { messages: page, has_more: hasMore, next_before: hasMore ? page[0].id : null }
  },

  async sendMessage(me, convoId, { body = '', file = null, clientId } = {}) {
    await delay(260)
    const v = viewer(me)
    findConvo(convoId, v)
    if (!v.canPost) throw err(403, 'Only Super Admin and Accounts can post messages')

    const text = String(body).trim()
    if (!text && !file) throw err(400, 'Message cannot be empty')

    const m = msg({
      id: nid(),
      convo: convoId,
      // The viewer's real uid, so it renders as their own message.
      sender: v.uid,
      clientId,
      at: Date.now(),
      body: text,
      attachment: file
        ? {
            id: nid(),
            name: file.name,
            mime: file.type,
            size: file.size,
            url: isImage(file.type) ? URL.createObjectURL(file) : '#',
          }
        : null,
    })
    m.sender_name = me.name
    m.sender_role = v.role
    state.messages.push(m)
    emit({ type: 'message:new', conversation_id: convoId, message: m })
    scheduleReply(convoId, v)
    return m
  },

  async editMessage(me, id, body) {
    await delay(200)
    const v = viewer(me)
    const m = state.messages.find((x) => x.id === Number(id))
    if (!m) throw err(404, 'Message not found')
    if (m.sender_uid !== v.uid) throw err(403, 'You can only edit your own messages')
    m.body = String(body).trim()
    m.edited_at = iso(Date.now())
    emit({ type: 'message:update', conversation_id: m.conversation_id, message: m })
    return m
  },

  async deleteMessage(me, id) {
    await delay(200)
    const v = viewer(me)
    const m = state.messages.find((x) => x.id === Number(id))
    if (!m) throw err(404, 'Message not found')
    const c = findConvo(m.conversation_id, v)
    // Same rule the server enforces: moderation is Community-room only, so a
    // Super Admin in a DM can delete only their own messages.
    const mayModerate = v.canModerate && c.kind === 'group'
    if (m.sender_uid !== v.uid && !mayModerate) {
      throw err(403, 'You can only delete your own messages')
    }
    m.deleted_at = iso(Date.now())
    m.body = ''
    m.attachment = null
    emit({ type: 'message:update', conversation_id: m.conversation_id, message: m })
    return m
  },

  async markRead(me, convoId) {
    await delay(60)
    const v = viewer(me)
    state.read[`${v.uid}:${convoId}`] = iso(Date.now())
    return { ok: true }
  },

  async searchMessages(me, convoId, q) {
    await delay(180)
    const v = viewer(me)
    const term = String(q || '').trim().toLowerCase()
    if (term.length < 2) return []
    findConvo(convoId, v)
    return state.messages
      .filter(
        (m) =>
          m.conversation_id === convoId &&
          !m.deleted_at &&
          (m.body || '').toLowerCase().includes(term)
      )
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 30)
  },

  async getPeople(me) {
    await delay(200)
    const v = viewer(me)
    if (!v.canPost) throw err(403, 'You do not have access to direct messages')
    return PEOPLE.filter((p) => p.id !== v.as).map((p) => ({ ...p, online: p.role === 'super_admin' }))
  },

  async createDirect(me, userId) {
    await delay(200)
    const v = viewer(me)
    if (!v.canPost) throw err(403, 'You do not have access to direct messages')
    const p = person(userId)
    if (!p) throw err(404, 'User not found')

    const pair = [v.as, userId].sort()
    const key = `dm-${pair.join('-')}`
    let c = state.conversations.find((x) => x.id === key)
    if (!c) {
      c = { id: key, kind: 'direct', title: p.name, member_ids: pair }
      state.conversations.push(c)
    }
    return convoSummary(c, v)
  },
}

/** Makes the mock behave like a peer is typing, then replying. */
function scheduleReply(convoId, v) {
  const convo = state.conversations.find((c) => c.id === convoId)
  if (!convo) return
  const peerId = convo.member_ids.find((id) => id !== v.as)
  if (!peerId) return
  const name = person(peerId)?.name || 'Someone'

  setTimeout(() => emit({ type: 'typing', conversation_id: convoId, name, typing: true }), 700)
  setTimeout(() => {
    emit({ type: 'typing', conversation_id: convoId, name, typing: false })
    const reply = msg({
      id: nid(),
      convo: convoId,
      sender: peerId,
      at: Date.now(),
      body: 'Noted, thanks. I will take a look and get back to you.',
    })
    state.messages.push(reply)
    emit({ type: 'message:new', conversation_id: convoId, message: reply })
  }, 2400)
}
