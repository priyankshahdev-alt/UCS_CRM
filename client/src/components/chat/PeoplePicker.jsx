import { useState, useEffect, useRef, useCallback } from 'react'
import { Avatar } from '../ui'
import { chatApi, isAuthError } from './chatApi'
import { roleLabel } from './chatIdentity'
import { ChatState } from './ChatState'
import { SearchIcon, CloseIcon, LockIcon } from './chatIcons'

/**
 * Screen 05 — pick someone to message.
 *
 * Writers only: the server answers `GET /api/chat/people` with 403 for every
 * read-only role, and the dialog is never rendered for them in the first place.
 * Escape closes, the backdrop closes, and focus is trapped inside so a keyboard
 * user cannot tab out into the inert page behind it.
 */
export default function PeoplePicker({ me, onClose, onPicked }) {
  const [people, setPeople] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const dialogRef = useRef(null)
  const closeRef = useRef(null)

  const load = useCallback(() => {
    let live = true
    setState('loading')
    chatApi
      .getPeople(me)
      .then((list) => {
        if (!live) return
        setPeople(Array.isArray(list) ? list : [])
        setState('ready')
      })
      .catch((e) => {
        if (!live) return
        setError(
          isAuthError(e)
            ? 'You do not have access to direct messages.'
            : e.message || 'Could not load people.'
        )
        setState(isAuthError(e) ? 'locked' : 'error')
      })
    return () => {
      live = false
    }
  }, [me])

  // Runs on mount and whenever `me` changes. "Try again" calls load() directly —
  // flipping state alone would not refetch, because this effect does not depend
  // on state, and the picker would sit on "Loading people." forever.
  useEffect(() => load(), [load])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // Simple focus trap across the dialog's own focusable elements.
      const nodes = dialogRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!nodes?.length) return
      const list = Array.from(nodes).filter((n) => !n.disabled && n.offsetParent !== null)
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const term = q.trim().toLowerCase()
  const shown = term
    ? people.filter(
        (p) => p.name.toLowerCase().includes(term) || roleLabel(p.role).toLowerCase().includes(term)
      )
    : people

  return (
    <div className="chat-overlay" onClick={onClose}>
      <div
        className="chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-picker-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chat-dialog-head">
          <h3 className="chat-dialog-title" id="chat-picker-title">
            New message
          </h3>
          <button
            ref={closeRef}
            type="button"
            className="chat-iconbtn"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="chat-dialog-body" style={{ paddingTop: 12 }}>
          {state === 'loading' && <p className="chat-state-sub">Loading people…</p>}

          {state === 'locked' && (
            <ChatState
              kind="locked"
              icon={LockIcon}
              title="Direct messages are not available"
              sub={error}
            />
          )}

          {state === 'error' && (
            <ChatState
              kind="error"
              title="Could not load people"
              sub={error}
              actionLabel="Try again"
              onAction={load}
            />
          )}

          {state === 'ready' && (
            <>
              <div className="chat-field" style={{ marginBottom: 10 }}>
                <span className="chat-field-icon">
                  <SearchIcon size={15} />
                </span>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name or role"
                  aria-label="Search people"
                />
              </div>

              {shown.length === 0 ? (
                <p className="chat-state-sub">No one matches “{q.trim()}”.</p>
              ) : (
                shown.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chat-person"
                    onClick={() => onPicked(p)}
                  >
                    <Avatar name={p.name} size={36} />
                    <span style={{ minWidth: 0 }}>
                      <span className="chat-person-name">{p.name}</span>
                      <br />
                      <span className="chat-person-role">{roleLabel(p.role)}</span>
                    </span>
                    <span className="chat-person-online" data-online={p.online ? 'true' : 'false'}>
                      {p.online ? 'Online' : 'Offline'}
                    </span>
                  </button>
                ))
              )}
            </>
          )}
        </div>

        <div className="chat-dialog-foot">
          <button type="button" className="chat-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
