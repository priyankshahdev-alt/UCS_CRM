import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { chatApi, CHAT_PAGE_SIZE, isAuthError } from './chatApi'
import { toast } from '../Toast'
import { isSameDay, formatDayLabel } from './chatTime'
import { DownIcon } from './chatIcons'
import MessageBubble from './MessageBubble'
import { ChatState, ChatThreadSkeleton } from './ChatState'

const NEAR_BOTTOM = 80
const LOAD_MORE_AT = 72
// Ceiling for the backwards walk a search jump performs. Deep enough for any
// realistic thread, shallow enough that one bad target cannot walk the whole
// table one page at a time.
const JUMP_MAX_PAGES = 25

/**
 * The scrolling message list.
 *
 * Two scroll behaviours have to coexist: reading forward should pin to the
 * bottom, but paging backwards must not move the reader's position. Paging
 * therefore measures the scroll height before the prepend and restores the
 * delta afterwards, instead of jumping to the top.
 */
export default function MessageThread({
  conversation,
  me,
  highlightId,
  onJumpHandled,
  onMarkRead,
  onRetry,
  optimistic = [],
}) {
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | empty | error | locked
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [stuckToBottom, setStuckToBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const [highlight, setHighlight] = useState(null)

  const scrollRef = useRef(null)
  const anchorRef = useRef(null)
  const convoId = conversation?.id
  const isGroup = conversation?.kind === 'group'
  const stickRef = useRef(true)

  // ---- loading ------------------------------------------------------------
  const loadInitial = useCallback(async () => {
    if (!convoId) return
    setStatus('loading')
    setError('')
    setMessages([])
    setHasMore(false)
    setUnseen(0)
    setJumpMiss(false)
    setJumping(false)
    setStuckToBottom(true)
    stickRef.current = true
    try {
      const res = await chatApi.getMessages(me, convoId, { limit: CHAT_PAGE_SIZE })
      const list = res?.messages || []
      setMessages(list)
      setHasMore(!!res?.has_more)
      setStatus(list.length ? 'ready' : 'empty')
    } catch (e) {
      if (isAuthError(e)) {
        setStatus('locked')
        setError(e.message)
      } else {
        setStatus('error')
        setError(e.message || 'Could not load messages.')
      }
    }
  }, [convoId, me])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  const loadOlder = useCallback(async () => {
    if (!convoId || loadingOlder || !hasMore || !messages.length) return
    const el = scrollRef.current
    if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
    setLoadingOlder(true)
    try {
      const res = await chatApi.getMessages(me, convoId, {
        before: messages[0].id,
        limit: CHAT_PAGE_SIZE,
      })
      const older = res?.messages || []
      if (older.length) {
        setMessages((prev) => {
          // Guard against a double-insert if a realtime event raced the page.
          const seen = new Set(prev.map((m) => m.id))
          return [...older.filter((m) => !seen.has(m.id)), ...prev]
        })
      }
      setHasMore(!!res?.has_more)
    } catch {
      setHasMore(false)
    } finally {
      setLoadingOlder(false)
    }
  }, [convoId, loadingOlder, hasMore, messages, me])

  const [jumping, setJumping] = useState(false)
  const [jumpMiss, setJumpMiss] = useState(false)

  /**
   * Pages backwards until `targetId` is loaded, then reports whether it landed.
   *
   * Search results can point at a message far outside the loaded window, and the
   * jump used to just scroll to a node that was not there: the highlight
   * cleared itself after 2.6s and nothing moved, so a search hit looked broken.
   * This walks the cursor instead, so the hit always becomes reachable.
   *
   * It keeps its own cursor rather than reusing loadOlder, because loadOlder
   * reads `messages` from the closure - fine for a single user-triggered page,
   * wrong for a loop, which would refetch the same page over and over.
   *
   * Bounded on purpose: JUMP_MAX_PAGES stops a pathological deep target from
   * hammering the API, and a miss is reported so the caller can say so.
   */
  const pageBackTo = useCallback(
    async (targetId) => {
      if (!convoId || targetId == null) return false
      setJumping(true)
      try {
        let cursor = messages[0]?.id
        const collected = []
        for (let i = 0; i < JUMP_MAX_PAGES; i++) {
          const res = await chatApi.getMessages(me, convoId, {
            before: cursor,
            limit: CHAT_PAGE_SIZE,
          })
          const page = res?.messages || []
          if (!page.length) break
          collected.push(...page)
          if (page.some((m) => m.id === targetId) || collected.some((m) => m.id === targetId)) {
            if (collected.length) {
              setMessages((prev) => {
                const seen = new Set(prev.map((m) => m.id))
                return [...collected.filter((m) => !seen.has(m.id)), ...prev]
              })
            }
            setHasMore(!!res?.has_more)
            return true
          }
          cursor = page[0].id
          if (!res?.has_more) break
        }
        // Exhausted the room without finding it: keep whatever we paged in so
        // the thread stays usable, and let the caller report the miss.
        if (collected.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id))
            return [...collected.filter((m) => !seen.has(m.id)), ...prev]
          })
        }
        return false
      } catch {
        return false
      } finally {
        setJumping(false)
      }
    },
    [convoId, me, messages]
  )

  // Preserve the reading position across a backwards page.
  useLayoutEffect(() => {
    const a = anchorRef.current
    const el = scrollRef.current
    anchorRef.current = null
    if (!a || !el) return
    el.scrollTop = el.scrollHeight - a.height + a.top
  }, [messages])

  // Pin to the newest message on first paint.
  const didInitialScroll = useRef(false)
  useEffect(() => {
    if (didInitialScroll.current || status !== 'ready') return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    didInitialScroll.current = true
  }, [status, messages.length])

  useEffect(() => {
    didInitialScroll.current = false
  }, [convoId])

  // ---- realtime -----------------------------------------------------------
  useEffect(() => {
    if (!convoId) return
    let live = true
    const off = chatApi.subscribe((evt) => {
      if (!live) return
      if (evt.conversation_id !== convoId) return

      if (evt.type === 'message:update' && evt.message) {
        setMessages((prev) => {
          const i = prev.findIndex((m) => m.id === evt.message.id)
          if (i === -1) return prev
          const next = prev.slice()
          next[i] = { ...next[i], ...evt.message }
          return next
        })
        return
      }

      if (evt.type === 'message:new' && evt.message) {
        setMessages((prev) => {
          // Reconcile an optimistic bubble by its client_id.
          const ci = evt.message.client_id
          const byId = prev.findIndex((m) => m.id === evt.message.id)
          if (byId !== -1) {
            const next = prev.slice()
            next[byId] = { ...next[byId], ...evt.message, pending: false, failed: false }
            return next
          }
          if (ci && prev.some((m) => m.client_id === ci && m.pending)) {
            return prev.map((m) =>
              m.client_id === ci && m.pending
                ? { ...m, ...evt.message, pending: false, failed: false }
                : m
            )
          }
          return [...prev, { ...evt.message, pending: false, failed: false }]
        })

        if (stickRef.current) {
          const el = scrollRef.current
          if (el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight))
        } else {
          setUnseen((n) => n + 1)
        }
      }
    })
    return () => {
      live = false
      off()
    }
  }, [convoId])

  // ---- mutations ----------------------------------------------------------
  // Edit and delete are applied optimistically, then reconciled by the realtime
  // `message:update` frame. A failure reverts and explains itself in place.
  const handleEdit = useCallback(
    async (message, { body }) => {
      const before = message.body
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, body, edited_at: new Date().toISOString() } : m))
      )
      try {
        const saved = await chatApi.editMessage(me, message.id, body)
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, ...saved, pending: false } : m))
        )
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, body: before } : m))
        )
        toast(e.message || 'Could not edit that message.', 'error')
      }
    },
    [me]
  )

  const handleDelete = useCallback(
    async (message) => {
      const snapshot = message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? { ...m, deleted_at: new Date().toISOString(), body: '', attachment: null }
            : m
        )
      )
      try {
        const gone = await chatApi.deleteMessage(me, message.id)
        setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...gone } : m)))
      } catch (e) {
        setMessages((prev) => prev.map((m) => (m.id === message.id ? snapshot : m)))
        toast(e.message || 'Could not delete that message.', 'error')
      }
    },
    [me]
  )

  // ---- read receipts ------------------------------------------------------
  // Only real, landed messages advance the read cursor.
  const lastId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!messages[i].pending && !messages[i].failed) return messages[i].id
    }
    return null
  }, [messages])
  useEffect(() => {
    if (status !== 'ready' || !lastId) return
    onMarkRead?.(convoId, lastId, stickRef.current)
  }, [lastId, status, convoId, onMarkRead])

  // ---- search jumps -------------------------------------------------------
  // A hit may sit outside the loaded window, so page it in first and only then
  // scroll. Scrolling straight away silently did nothing for those hits.
  useEffect(() => {
    if (!highlightId) return
    let alive = true
    // Declared before the async body can touch it: when the target is already
    // loaded there is no await, so the body runs synchronously up to the
    // timers.push below and would hit the temporal dead zone.
    const timers = []
    const clear = () => {
      setHighlight(null)
      onJumpHandled?.()
    }

    const run = async () => {
      const present = messages.some((m) => m.id === highlightId)
      if (!present) {
        const found = await pageBackTo(highlightId)
        if (!alive) return
        if (!found) {
          setJumpMiss(true)
          clear()
          return
        }
      }
      if (!alive) return
      setJumpMiss(false)
      setHighlight(highlightId)
      // Wait for the paged-in batch to paint before scrolling to it.
      const t = setTimeout(() => {
        const el = scrollRef.current?.querySelector(`[data-mid="${highlightId}"]`)
        if (el) el.scrollIntoView({ block: 'center' })
      }, 60)
      const done = setTimeout(clear, 2600)
      timers.push(t, done)
    }
    run()
    return () => {
      alive = false
      timers.forEach(clearTimeout)
    }
  }, [highlightId, messages, pageBackTo, onJumpHandled])

  // ---- scroll handling ----------------------------------------------------
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = bottomGap < NEAR_BOTTOM
    stickRef.current = atBottom
    setStuckToBottom(atBottom)
    if (atBottom) setUnseen(0)
    if (el.scrollTop < LOAD_MORE_AT) loadOlder()
  }, [loadOlder])

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    setStuckToBottom(true)
    setUnseen(0)
    el.scrollTop = el.scrollHeight
  }, [])

  // Group consecutive messages from one sender so the avatar/name appear once.
  // Pending sends live in the workspace, not here, so they are merged in at
  // render time and dropped the moment a real message carries the same client_id.
  const merged = useMemo(() => {
    const settled = new Set(
      messages.map((m) => m.client_id).filter(Boolean)
    )
    const pending = optimistic.filter((m) => !settled.has(m.client_id))
    if (!pending.length) return messages
    return [...messages, ...pending].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    )
  }, [messages, optimistic])

  const rows = useMemo(() => {
    const out = []
    merged.forEach((m, i) => {
      const prev = merged[i - 1]
      const sameSender = prev && prev.sender_uid === m.sender_uid && !prev.deleted_at
      const withinWindow = prev && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60 * 1000
      const newDay = !prev || !isSameDay(prev.created_at, m.created_at)
      const separator = newDay ? formatDayLabel(m.created_at) : null
      // A run of messages from one sender collapses to a single identity header.
      // Never label your own messages — you already know they are yours.
      const startsRun = !sameSender || !withinWindow || newDay
      out.push({
        key: `${m.id}`,
        message: m,
        separator,
        showAvatar: isGroup && startsRun,
        showSender: isGroup && startsRun && m.sender_uid !== me.uid,
      })
    })
    return out
  }, [merged, isGroup, me.uid])

  if (status === 'loading') {
    return (
      <div className="chat-messages">
        <ChatThreadSkeleton />
      </div>
    )
  }

  if (status === 'locked') {
    return (
      <ChatState
        kind="locked"
        title="You do not have access to this conversation"
        sub={error || 'Ask a Super Admin if you think this is wrong.'}
      />
    )
  }

  if (status === 'error') {
    return (
      <ChatState
        kind="error"
        title="Could not load messages"
        sub={error}
        actionLabel="Try again"
        onAction={loadInitial}
      />
    )
  }

  if (status === 'empty' && !optimistic.length) {
    return (
      <ChatState
        title="No messages yet"
        sub={
          me.canPost
            ? 'Start the conversation — everyone in this room will see it.'
            : 'Nothing has been posted here yet. You will be notified when it is.'
        }
      />
    )
  }

  return (
    <div
      className="chat-messages"
      ref={scrollRef}
      onScroll={onScroll}
      role="log"
      aria-label="Messages"
      aria-live="polite"
      aria-relevant="additions"
      style={{ position: 'relative' }}
    >
      {loadingOlder && (
        <div className="chat-topnote" role="status">
          Loading earlier messages…
        </div>
      )}
      {jumping && (
        <div className="chat-topnote" role="status">
          Finding that message…
        </div>
      )}
      {jumpMiss && (
        <div className="chat-topnote" role="status">
          That message is too far back to open. Try a more specific search.
        </div>
      )}
      {!hasMore && messages.length > 0 && (
        <div className="chat-topnote">This is the beginning of the conversation.</div>
      )}

      {rows.map(({ key, message, separator, showAvatar, showSender }) => (
        <div key={key}>
          {separator && (
            <div className="chat-daysep" role="separator" aria-label={separator}>
              <span>{separator}</span>
            </div>
          )}
          <div data-mid={message.id}>
            <MessageBubble
              message={message}
              me={me}
              isGroup={isGroup}
              showAvatar={showAvatar}
              showSender={showSender}
              highlighted={highlight === message.id}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRetry={onRetry}
            />
          </div>
        </div>
      ))}

      {!stuckToBottom && unseen > 0 && (
        <button type="button" className="chat-jump" onClick={jumpToBottom}>
          <DownIcon size={14} />
          {unseen} new {unseen === 1 ? 'message' : 'messages'}
        </button>
      )}
    </div>
  )
}
