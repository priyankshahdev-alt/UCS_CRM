import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useUcs } from '../../store'
import { toast } from '../Toast'
import { Avatar } from '../ui'
import { chatApi, isAuthError } from './chatApi'
import { resolveChatIdentity } from './chatIdentity'
import { useTypingIn, useUnreadCount } from './useChatRealtime'
import ConversationList from './ConversationList'
import MessageThread from './MessageThread'
import ChatComposer from './ChatComposer'
import ChatSearch from './ChatSearch'
import ReadOnlyBanner from './ReadOnlyBanner'
import PeoplePicker from './PeoplePicker'
import { ChatState, ChatThreadSkeleton } from './ChatState'
import { ChatIcon, BackIcon, SearchIcon } from './chatIcons'
import './chat.css'

/**
 * The whole chat feature, as one embeddable surface.
 *
 * Every host panel mounts this same component and only differs in which
 * capabilities the resolved identity grants. Below 768px it switches to a single
 * pane driven by `data-view`, because the two-column grid is unusable at phone
 * widths and a squeezed thread is worse than a deliberate drill-down.
 */
export default function ChatWorkspace() {
  const { user } = useUcs()
  const me = useMemo(() => resolveChatIdentity(user), [user])

  const [conversations, setConversations] = useState([])
  const [listStatus, setListStatus] = useState('loading')
  const [listError, setListError] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [view, setView] = useState('list')
  const [tab, setTab] = useState('all')
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [highlightId, setHighlightId] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [optimistic, setOptimistic] = useState([])
  const [unreadKey, setUnreadKey] = useState(0)

  const active = conversations.find((c) => c.id === activeId) || null
  const typers = useTypingIn(activeId)
  const { refresh: refreshUnread } = useUnreadCount(me, unreadKey)

  // ---- conversation list --------------------------------------------------
  const loadConversations = useCallback(async () => {
    if (!me?.uid) return
    setListStatus('loading')
    setListError('')
    try {
      const list = await chatApi.listConversations(me)
      const arr = Array.isArray(list) ? list : []
      setConversations(arr)
      setListStatus('ready')
      // Land on Community: the one room every role can see.
      setActiveId((prev) => {
        if (prev && arr.some((c) => c.id === prev)) return prev
        const community = arr.find((c) => c.kind === 'group')
        return community?.id || arr[0]?.id || null
      })
    } catch (e) {
      setListError(e.message || 'Could not load conversations.')
      setListStatus(isAuthError(e) ? 'locked' : 'error')
    }
  }, [me])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  // Keep previews, ordering and unread counts live without refetching the list.
  useEffect(() => {
    if (!me?.uid) return
    return chatApi.subscribe((evt) => {
      if (evt.type === 'message:new' && evt.message) {
        const m = evt.message
        setConversations((prev) => {
          const i = prev.findIndex((c) => c.id === m.conversation_id)
          if (i === -1) return prev
          const next = prev.slice()
          const conv = next[i]
          next[i] = {
            ...conv,
            last_message: {
              id: m.id,
              sender_name: m.sender_name,
              body: m.deleted_at
                ? 'This message was deleted'
                : m.attachment && !m.body
                  ? m.attachment.name
                  : m.body,
              created_at: m.created_at,
              deleted: !!m.deleted_at,
            },
            unread_count:
              m.sender_uid === me.uid
                ? conv.unread_count
                : m.conversation_id === activeId
                  ? 0
                  : (conv.unread_count || 0) + 1,
          }
          // Most recent activity floats to the top, group room pinned separately.
          return [...next.filter((_, idx) => idx !== i), next[i]]
        })
        setUnreadKey((k) => k + 1)
      }
      if (evt.type === 'message:update' && evt.message) {
        const m = evt.message
        setConversations((prev) =>
          prev.map((c) =>
            c.id === m.conversation_id && c.last_message?.id === m.id
              ? {
                  ...c,
                  last_message: {
                    ...c.last_message,
                    body: m.deleted_at
                      ? 'This message was deleted'
                      : m.attachment && !m.body
                        ? m.attachment.name
                        : m.body,
                    deleted: !!m.deleted_at,
                  },
                }
              : c
          )
        )
      }
    })
  }, [me, activeId])

  // ---- selection ----------------------------------------------------------
  const select = useCallback((c) => {
    setActiveId(c.id)
    setView('thread')
    setSearchOpen(false)
    setHighlightId(null)
    setOptimistic([])
    // Opening a room clears its badge immediately; the server call follows.
    setConversations((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x))
    )
    setUnreadKey((k) => k + 1)
  }, [])

  const handleMarkRead = useCallback(
    (convoId, messageId) => {
      if (!convoId || !messageId) return
      chatApi.markRead(me, convoId, messageId).catch(() => {})
      refreshUnread?.()
    },
    [me, refreshUnread]
  )

  // ---- sending ------------------------------------------------------------
  const send = useCallback(
    async ({ body, file }) => {
      if (!active) return
      const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const entry = {
        id: `tmp-${clientId}`,
        client_id: clientId,
        conversation_id: active.id,
        sender_uid: me.uid,
        sender_name: me.name,
        sender_role: me.role,
        body,
        created_at: new Date().toISOString(),
        attachment: file
          ? {
              id: `tmp-att-${clientId}`,
              name: file.name,
              mime: file.type,
              size: file.size,
              url: file.type?.startsWith('image/') ? URL.createObjectURL(file) : '#',
            }
          : null,
        pending: true,
        failed: false,
        // Kept so a retry can re-send the same file without re-picking it.
        _file: file || null,
      }
      setOptimistic((prev) => [...prev, entry])

      try {
        const saved = await chatApi.sendMessage(me, active.id, { body, file, clientId })
        // Reconcile from the HTTP response rather than waiting on the socket.
        // The realtime frame still arrives and is matched by client_id, so this
        // is idempotent — but if the socket is down the bubble still stops
        // spinning instead of hanging on "pending" forever.
        if (saved?.id) {
          setOptimistic((prev) =>
            prev.map((m) => (m.client_id === clientId ? { ...m, ...saved, pending: false, failed: false } : m))
          )
        }
      } catch (e) {
        setOptimistic((prev) =>
          prev.map((m) => (m.client_id === clientId ? { ...m, pending: false, failed: true } : m))
        )
        if (isAuthError(e)) {
          toast(e.message || 'You are not allowed to post here.', 'error')
        }
      }
    },
    [active, me]
  )

  const retry = useCallback(
    async (message) => {
      const entry = optimistic.find((m) => m.client_id === message.client_id)
      if (!entry || !active) return
      setOptimistic((prev) =>
        prev.map((m) => (m.client_id === entry.client_id ? { ...m, pending: true, failed: false } : m))
      )
      try {
        await chatApi.sendMessage(me, active.id, {
          body: entry.body,
          file: entry._file,
          clientId: entry.client_id,
        })
      } catch {
        setOptimistic((prev) =>
          prev.map((m) => (m.client_id === entry.client_id ? { ...m, pending: false, failed: true } : m))
        )
      }
    },
    [optimistic, active, me]
  )

  // ---- new direct message -------------------------------------------------
  const startDirect = useCallback(
    async (person) => {
      setPickerOpen(false)
      try {
        const convo = await chatApi.createDirect(me, person.id)
        setConversations((prev) => {
          const exists = prev.find((c) => c.id === convo.id)
          return exists ? prev.map((c) => (c.id === convo.id ? convo : c)) : [convo, ...prev]
        })
        select(convo)
        // The socket joined its rooms on connect and this room did not exist
        // then, so tell it to re-resolve or neither side gets live messages.
        chatApi.rejoinRooms()
      } catch (e) {
        toast(e.message || 'Could not open that conversation.', 'error')
      }
    },
    [me, select]
  )

  // ---- render -------------------------------------------------------------
  if (!me?.uid) {
    return (
      <div className="chat-page chat-scope">
        <ChatState kind="locked" title="Sign in to use Community" sub="Your session has expired." />
      </div>
    )
  }

  if (listStatus === 'locked') {
    return (
      <div className="chat-page chat-scope">
        <ChatState
          kind="locked"
          title="Community is not available for your account"
          sub={listError || 'Ask a Super Admin to add you to the community room.'}
        />
      </div>
    )
  }

  const showThreadPane = !!active

  return (
    <div className="chat-page chat-scope">
      <div className="chat-workspace" data-view={view}>
        <aside className="chat-rail" aria-label="Conversations">
          <ConversationList
            title="Community"
            conversations={conversations}
            activeId={activeId}
            onSelect={select}
            tab={tab}
            onTab={setTab}
            filter={filter}
            onFilter={setFilter}
            loading={listStatus === 'loading'}
            error={listStatus === 'error' ? listError : ''}
            onRetry={loadConversations}
            canDm={me.canDm}
            onNewMessage={() => setPickerOpen(true)}
            loadingNode={<ChatThreadSkeleton rows={6} />}
          />
        </aside>

        <section className="chat-thread" aria-label="Conversation">
          {showThreadPane ? (
            <>
              <header className="chat-thread-head">
                <button
                  type="button"
                  className="chat-iconbtn chat-backbtn"
                  onClick={() => setView('list')}
                  aria-label="Back to conversations"
                >
                  <BackIcon />
                </button>

                {active.kind === 'group' ? (
                  <span
                    className="avatar"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'var(--chat-navy)',
                      color: '#fff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    <ChatIcon size={19} />
                  </span>
                ) : (
                  <Avatar name={active.title} size={36} />
                )}

                <div className="chat-thread-head-body">
                  <h2 className="chat-thread-title">
                    {active.kind === 'group' ? 'Community' : active.title}
                  </h2>
                  <div className="chat-thread-sub">
                    {active.kind === 'group'
                      ? `${active.member_count || 0} members · everyone at UCS`
                      : 'Direct message'}
                  </div>
                </div>

                <button
                  type="button"
                  className="chat-iconbtn"
                  onClick={() => {
                    setSearchOpen((v) => !v)
                    setHighlightId(null)
                  }}
                  aria-label="Search messages"
                  title="Search messages"
                  aria-expanded={searchOpen}
                >
                  <SearchIcon size={18} />
                </button>
              </header>

              {searchOpen && (
                <ChatSearch
                  conversation={active}
                  me={me}
                  onClose={() => setSearchOpen(false)}
                  onJump={(m) => setHighlightId(m.id)}
                />
              )}

              <MessageThread
                conversation={active}
                me={me}
                optimistic={optimistic}
                highlightId={highlightId}
                onJumpHandled={() => setHighlightId(null)}
                onMarkRead={handleMarkRead}
                onRetry={retry}
              />

              <div style={{ flexShrink: 0 }}>
                {typers.length > 0 && (
                  <div className="chat-typing" role="status" aria-live="polite">
                    {typers.length === 1
                      ? `${typers[0]} is typing…`
                      : `${typers.length} people are typing…`}
                  </div>
                )}
                {me.canPost ? (
                  <ChatComposer conversation={active} me={me} onSend={send} />
                ) : (
                  <ReadOnlyBanner />
                )}
              </div>
            </>
          ) : (
            <ChatState
              title="Select a conversation"
              sub="Pick the Community room to read the latest updates."
            />
          )}
        </section>
      </div>

      {pickerOpen && (
        <PeoplePicker me={me} onClose={() => setPickerOpen(false)} onPicked={startDirect} />
      )}
    </div>
  )
}
