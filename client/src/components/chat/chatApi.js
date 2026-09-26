/**
 * Community chat API client.
 *
 * Shapes here mirror `backend/src/routes/chatRoutes.js` as specified in
 * plan.md §6, so switching off the mock is a one-env-flag change with no edits
 * to any component.
 *
 *   GET    /api/chat/people                       writer only, 403 otherwise
 *   GET    /api/chat/conversations                DMs filtered for read-only
 *   POST   /api/chat/conversations/direct         writer only
 *   GET    /api/chat/conversations/:id/messages   ?before=<id>&limit=50
 *   POST   /api/chat/conversations/:id/messages   multipart, file + body
 *   POST   /api/chat/conversations/:id/read       upsert own read cursor
 *   GET    /api/chat/conversations/:id/search     ?q=
 *   PATCH  /api/chat/messages/:id                 writer + sender only
 *   DELETE /api/chat/messages/:id                 writer + sender OR superadmin
 *   GET    /api/chat/unread-count                 nav badge
 *
 * Every method takes the resolved identity first. The HTTP path deliberately
 * ignores it and derives the real user from the bearer token — the client
 * value exists so the mock can enforce the same permission matrix, and so
 * components can render capabilities without a second round trip.
 */

import { api } from '../../api/auth'
import { onDbChange, getSocket } from '../../lib/socket'
import { mockChatApi } from './chatMock'

// The chat backend is not mounted yet. Until it is, the screens run against an
// in-memory mock so every state in designed.md §6 is reachable for review.
// Set VITE_CHAT_MOCK=false in client/.env to talk to the real routes.
export const CHAT_MOCK = import.meta.env.VITE_CHAT_MOCK !== 'false'

export const CHAT_PAGE_SIZE = 50

function statusOf(err) {
  const s = Number(err?.status)
  return Number.isFinite(s) && s > 0 ? s : 0
}

/**
 * 401/403/404 all mean the same thing to the chat UI: this viewer may not see
 * this conversation. Render a locked state rather than a broken pane.
 *
 * 404 is the interesting one: a refused DM lookup returns 404 rather than 403 so
 * the response cannot be used to probe which private conversations exist.
 */
export function isAuthError(err) {
  // A missing route is not an auth failure. Reporting it as one shows "your
  // session expired" to a perfectly valid session and hides the real problem
  // (the /api/chat routes are not deployed on the server being called).
  if (err?.routeMissing) return false
  const s = Number(err?.status)
  if (s === 401 || s === 403 || s === 404) return true
  return /unauthor|forbidden|not found|no longer|not a member|do not have|does not have/i.test(
    err?.message || ''
  )
}

/**
 * True when the server answering this request does not have the route at all.
 * The chat UI shows an honest "not deployed here" message instead of asking the
 * user to sign in again, which cannot help when the token is fine.
 */
export function isRouteMissing(err) {
  return !!err?.routeMissing
}

const http = {
  listConversations: () => api('/chat/conversations', { _prefix: 'ucs' }),

  getPeople: () => api('/chat/people', { _prefix: 'ucs' }),

  createDirect: (_me, userId) =>
    api('/chat/conversations/direct', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
      _prefix: 'ucs',
    }),

  getMessages: (_me, convoId, { before, limit = CHAT_PAGE_SIZE, signal } = {}) => {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (before) qs.set('before', String(before))
    return api(
      `/chat/conversations/${encodeURIComponent(convoId)}/messages?${qs}`,
      { _prefix: 'ucs', signal }
    )
  },

  sendMessage: (_me, convoId, { body = '', file = null, clientId } = {}) => {
    const fd = new FormData()
    const text = String(body || '').trim()
    if (text) fd.append('body', text)
    if (file) fd.append('file', file)
    if (clientId) fd.append('client_id', clientId)
    return api(`/chat/conversations/${encodeURIComponent(convoId)}/messages`, {
      method: 'POST',
      body: fd,
      _prefix: 'ucs',
    })
  },

  markRead: (_me, convoId, messageId) =>
    api(`/chat/conversations/${encodeURIComponent(convoId)}/read`, {
      method: 'POST',
      body: JSON.stringify({ message_id: messageId }),
      _prefix: 'ucs',
    }),

  searchMessages: (_me, convoId, q, { signal } = {}) =>
    api(
      `/chat/conversations/${encodeURIComponent(convoId)}/search?q=${encodeURIComponent(q)}`,
      { _prefix: 'ucs', signal }
    ),

  editMessage: (_me, messageId, body) =>
    api(`/chat/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
      _prefix: 'ucs',
    }),

  deleteMessage: (_me, messageId) =>
    api(`/chat/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      _prefix: 'ucs',
    }),

  getUnreadCount: () => api('/chat/unread-count', { _prefix: 'ucs' }),
}

/**
 * Realtime.
 *
 * Chat listens on its own `chat:message` event rather than the shared
 * `db:change` bridge. `db:change` is an io.emit to every connected socket, so
 * subscribing to chat_messages through it would push every DM body to all six
 * read-only roles - invisible in the UI, but present in their tab's memory. The
 * server emits `chat:message` scoped to `chat:<conversationId>`, and a socket
 * only joins the rooms it participates in.
 */
function subscribeHttp(handler) {
  const s = getSocket()
  const offs = [
    onDbChange({
      table: 'chat_conversations',
      onUpdate: (row) => handler({ type: 'conversation:update', conversation: row }),
    }),
  ]
  const onMessage = (p) => {
    if (!p || !p.conversation_id) return
    handler({
      type: p.type,
      conversation_id: p.conversation_id,
      message: p.message,
    })
  }
  const onTyping = (p) => handler({ type: 'typing', ...p })
  const onPresence = (p) => handler({ type: 'presence', ...p })
  s.on('chat:message', onMessage)
  s.on('chat:typing', onTyping)
  s.on('chat:presence', onPresence)
  offs.push(() => s.off('chat:message', onMessage))
  offs.push(() => s.off('chat:typing', onTyping))
  offs.push(() => s.off('chat:presence', onPresence))
  return () => offs.forEach((fn) => fn())
}

/** Sending typing frames. Throttled by the composer, so this just emits. */
function sendTypingHttp(convoId, typing) {
  try {
    getSocket().emit('chat:typing', { conversation_id: convoId, typing: !!typing })
  } catch {
    /* socket not connected — typing is best effort */
  }
}

/**
 * Asks the server to re-resolve our chat rooms.
 *
 * The socket joins every room this identity is a member of when it connects, so
 * a DM created later is a room it has never entered. Without this, the sender
 * and the recipient would not receive each other's messages until they reload.
 */
function rejoinRoomsHttp() {
  try {
    getSocket().emit('chat:join')
  } catch {
    /* socket not connected — it will join on the next connect */
  }
}

const impl = CHAT_MOCK ? mockChatApi : http

export const chatApi = {
  listConversations: (me) => impl.listConversations(me),
  getUnreadCount: (me) => impl.getUnreadCount(me),
  getPeople: (me) => impl.getPeople(me),
  createDirect: (me, userId) => impl.createDirect(me, userId),
  getMessages: (me, convoId, opts) => impl.getMessages(me, convoId, opts),
  sendMessage: (me, convoId, payload) => impl.sendMessage(me, convoId, payload),
  markRead: (me, convoId, messageId) => impl.markRead(me, convoId, messageId),
  searchMessages: (me, convoId, q, opts) => impl.searchMessages(me, convoId, q, opts),
  editMessage: (me, messageId, body) => impl.editMessage(me, messageId, body),
  deleteMessage: (me, messageId) => impl.deleteMessage(me, messageId),
  subscribe: (handler) => (CHAT_MOCK ? mockChatApi.__subscribe(handler) : subscribeHttp(handler)),
  sendTyping: (convoId, typing) => {
    if (CHAT_MOCK) return
    sendTypingHttp(convoId, typing)
  },
  rejoinRooms: () => {
    if (CHAT_MOCK) return
    rejoinRoomsHttp()
  },
}
