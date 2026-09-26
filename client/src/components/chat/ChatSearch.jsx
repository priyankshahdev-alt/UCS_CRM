import { useState, useRef, useEffect } from 'react'
import { chatApi, isAuthError } from './chatApi'
import { formatTime, formatDayLabel } from './chatTime'
import { SearchIcon, CloseIcon, AlertIcon } from './chatIcons'

const DEBOUNCE_MS = 300
const MIN_CHARS = 2

/**
 * Screen 08 — inline search.
 *
 * Results are a navigation aid, not a replacement for the thread: picking a hit
 * scrolls the real message into view and highlights it there, so the reader
 * keeps their place in the conversation. The clamp is enforced server-side too —
 * a crafted conversation id cannot reach a DM.
 */
export default function ChatSearch({ conversation, me, onJump, onClose }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [state, setState] = useState('idle') // idle | loading | done | error
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  const convoId = conversation?.id

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const term = q.trim()
    if (term.length < MIN_CHARS) {
      setResults([])
      setState('idle')
      setError('')
      return
    }
    setState('loading')
    const t = setTimeout(async () => {
      try {
        const found = await chatApi.searchMessages(me, convoId, term)
        setResults(Array.isArray(found) ? found : found?.results || [])
        setState('done')
      } catch (e) {
        setError(
          isAuthError(e)
            ? 'You do not have access to search this conversation.'
            : e.message || 'Search failed.'
        )
        setResults([])
        setState('error')
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q, convoId, me])

  return (
    <div className="chat-search-panel" role="search" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="chat-search-head">
        <div className="chat-field" style={{ flex: 1 }}>
          <span className="chat-field-icon">
            <SearchIcon size={16} />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={q}
            placeholder="Search messages"
            aria-label="Search messages in this conversation"
            onChange={(e) => setQ(e.target.value)}
          />
          {state === 'loading' && (
            <span className="chat-field-icon" style={{ fontSize: 11 }}>
              …
            </span>
          )}
        </div>
        <button
          type="button"
          className="chat-iconbtn"
          onClick={onClose}
          aria-label="Close search"
          title="Close"
        >
          <CloseIcon size={18} />
        </button>
      </div>

      {state === 'idle' ? (
        <p className="chat-search-count" style={{ margin: 0 }}>
          Type at least {MIN_CHARS} characters.
        </p>
      ) : state === 'error' ? (
        <p className="chat-search-count" style={{ margin: 0, color: 'var(--chat-danger)' }}>
          <AlertIcon size={13} /> {error}
        </p>
      ) : state === 'done' && results.length === 0 ? (
        <p className="chat-search-count" style={{ margin: 0 }}>
          No messages match “{q.trim()}”.
        </p>
      ) : (
        results.length > 0 && (
          <>
            <p className="chat-search-count" style={{ margin: 0 }}>
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </p>
            <div className="chat-search-results">
              {results.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chat-hit"
                  onClick={() => onJump(m)}
                >
                  <span className="chat-hit-top">
                    <span className="chat-hit-sender">{m.sender_name}</span>
                    <span>
                      {formatDayLabel(m.created_at)} · {formatTime(m.created_at)}
                    </span>
                  </span>
                  <span className="chat-hit-text">
                    <Highlight text={m.body} term={q.trim()} />
                  </span>
                </button>
              ))}
            </div>
          </>
        )
      )}
    </div>
  )
}

/** Wraps matches in <mark> without ever injecting HTML. */
function Highlight({ text, term }) {
  const src = String(text || '')
  const needle = term.toLowerCase()
  if (!needle) return src

  const out = []
  let from = 0
  let at = src.toLowerCase().indexOf(needle, from)
  let key = 0
  while (at !== -1) {
    if (at > from) out.push(src.slice(from, at))
    out.push(
      <mark key={key++}>{src.slice(at, at + needle.length)}</mark>
    )
    from = at + needle.length
    at = src.toLowerCase().indexOf(needle, from)
  }
  if (from < src.length) out.push(src.slice(from))
  return out
}
