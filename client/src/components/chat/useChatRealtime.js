import { useEffect, useRef, useState, useCallback } from 'react'
import { chatApi } from './chatApi'

/**
 * Subscribes to chat realtime events for the lifetime of the component.
 * The handler is held in a ref so callers do not have to memoise it and
 * re-subscribe on every render.
 */
export function useChatEvents(handler) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => chatApi.subscribe((evt) => ref.current?.(evt)), [])
}

/**
 * Who is typing in `conversationId`.
 * Frames expire on their own so a dropped "stopped typing" cannot leave a
 * ghost indicator up forever.
 */
export function useTypingIn(conversationId) {
  const [typers, setTypers] = useState([])
  const expiry = useRef(new Map())

  useChatEvents(
    useCallback((evt) => {
      if (evt.type !== 'typing') return
      if (evt.conversation_id !== conversationId) return
      const name = evt.name
      if (!name) return
      if (evt.typing) {
        expiry.current.set(name, Date.now() + 6000)
        setTypers((prev) => (prev.includes(name) ? prev : [...prev, name]))
      } else {
        expiry.current.delete(name)
        setTypers((prev) => prev.filter((n) => n !== name))
      }
    }, [conversationId])
  )

  useEffect(() => {
    if (!typers.length) return
    const t = setInterval(() => {
      const now = Date.now()
      let changed = false
      expiry.current.forEach((deadline, name) => {
        if (deadline < now) {
          expiry.current.delete(name)
          changed = true
        }
      })
      if (changed) setTypers((prev) => prev.filter((n) => expiry.current.has(n)))
    }, 1500)
    return () => clearInterval(t)
  }, [typers.length])

  useEffect(() => {
    expiry.current.clear()
    setTypers([])
  }, [conversationId])

  return typers
}

/**
 * Unread total for the nav badge. Re-reads whenever `refreshKey` changes, so
 * the panel can nudge it after the workspace marks something read.
 */
export function useUnreadCount(me, refreshKey = 0) {
  const [count, setCount] = useState(0)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(() => {
    if (!me?.uid) return
    let live = true
    chatApi
      .getUnreadCount(me)
      .then((n) => {
        if (!live) return
        setCount(Number(n) || 0)
        setLoaded(true)
      })
      .catch(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [me?.uid])

  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])

  // Keep the badge honest while the tab is open.
  useChatEvents(
    useCallback(() => {
      refresh()
    }, [refresh])
  )

  return { count, loaded, refresh }
}
