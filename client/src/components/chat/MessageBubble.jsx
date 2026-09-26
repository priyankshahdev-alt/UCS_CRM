import { useState, useRef, useEffect } from 'react'
import { Avatar } from '../ui'
import { roleLabel } from './chatIdentity'
import { formatTime, fullStamp } from './chatTime'
import { EditIcon, TrashIcon, CheckIcon, AlertIcon, RetryIcon } from './chatIcons'
import MessageAttachment from './AttachmentPreview'

/**
 * Screen 07 — one message.
 *
 * Own vs other alignment, sender identity in the group room, soft-delete
 * tombstone, and the edit/delete affordances. Capabilities are computed from the
 * resolved identity here, but the server is what enforces them: a hidden control
 * is a courtesy, not a guard.
 */
export default function MessageBubble({
  message,
  me,
  isGroup,
  showAvatar,
  showSender,
  highlighted,
  onEdit,
  onRetry,
  onDelete,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const areaRef = useRef(null)

  const own = message.sender_uid === me.uid
  const deleted = !!message.deleted_at
  const pending = !!message.pending
  const failed = !!message.failed
  const sent = !pending && !failed

  // Editing is always sender-only, even for a moderator.
  const canEdit = own && sent && !deleted
  // Moderation is scoped to the Community room. A Super Admin sitting in a DM is
  // an ordinary participant there, so they get no delete affordance on the other
  // person's messages - otherwise the UI implies they can moderate a private
  // conversation, which the server does not permit.
  const canModerateHere = isGroup && me.canModerate
  const canDelete = sent && !deleted && (own || canModerateHere)
  const moderating = !own && canModerateHere

  useEffect(() => {
    if (!editing) return
    setDraft(message.body || '')
    const t = setTimeout(() => {
      const el = areaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 0)
    return () => clearTimeout(t)
  }, [editing, message.body])

  if (failed) {
    return (
      <div className="chat-row" data-own={own ? 'true' : 'false'} data-first="true">
        {isGroup && !own && showAvatar && (
          <div className="chat-row-avatar">
            <Avatar name={message.sender_name} size={28} />
          </div>
        )}
        <div className="chat-bubble" data-status="failed" role="alert">
          {message.attachment && <MessageAttachment attachment={message.attachment} />}
          {message.body && <p className="chat-bubble-text">{message.body}</p>}
          <div className="chat-bubble-foot">
            <AlertIcon size={13} />
            <span>Not sent</span>
            <button
              type="button"
              className="chat-bubble-action"
              style={{ position: 'static', opacity: 1, width: 22, height: 22 }}
              onClick={() => onRetry?.(message)}
              aria-label="Retry sending this message"
              title="Retry"
            >
              <RetryIcon size={13} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="chat-row"
      data-own={own ? 'true' : 'false'}
      data-first={showSender ? 'true' : 'false'}
    >
      {isGroup && !own && (
        <div className="chat-row-avatar">
          {/* Rendered only on the first of a run; the wrapper keeps height stable. */}
          {showAvatar ? <Avatar name={message.sender_name} size={28} /> : null}
        </div>
      )}

      <div
        className="chat-bubble"
        data-deleted={deleted ? 'true' : undefined}
        data-status={pending ? 'pending' : undefined}
        data-highlight={highlighted ? 'true' : undefined}
      >
        {(canEdit || canDelete) && !editing && !confirming && (
          <div className="chat-bubble-actions">
            {canEdit && (
              <button
                type="button"
                className="chat-bubble-action"
                onClick={() => setEditing(true)}
                aria-label="Edit this message"
                title="Edit"
              >
                <EditIcon size={14} />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                className="chat-bubble-action"
                data-danger="true"
                onClick={() => setConfirming(true)}
                aria-label="Delete this message"
                title="Delete"
              >
                <TrashIcon size={14} />
              </button>
            )}
          </div>
        )}

        {showSender && !deleted && (
          <div className="chat-bubble-sender">
            {message.sender_name}
            <span className="chat-bubble-role">{roleLabel(message.sender_role)}</span>
          </div>
        )}

        {deleted ? (
          <span className="chat-tombstone">This message was deleted</span>
        ) : editing ? (
          <div className="chat-inline-editor">
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commitEdit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                }
              }}
              aria-label="Edit message"
              maxLength={4000}
            />
            <div className="chat-inline-editor-actions">
              <button
                type="button"
                className="chat-btn chat-btn-ghost"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="chat-btn chat-btn-primary"
                onClick={commitEdit}
                disabled={busy || !draft.trim()}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : confirming ? (
          <ConfirmDelete
            senderName={message.sender_name}
            moderating={moderating}
            busy={busy}
            onCancel={() => setConfirming(false)}
            onConfirm={commitDelete}
          />
        ) : (
          <>
            {message.attachment && !message.body && (
              <MessageAttachment attachment={message.attachment} />
            )}
            {message.body && <p className="chat-bubble-text">{message.body}</p>}
            {message.attachment && message.body && (
              <div style={{ marginTop: 6 }}>
                <MessageAttachment attachment={message.attachment} />
              </div>
            )}
          </>
        )}

        {!editing && !confirming && !deleted && (
          <div className="chat-bubble-foot">
            {message.edited_at && <span className="chat-bubble-edited">edited</span>}
            <time dateTime={message.created_at} title={fullStamp(message.created_at)}>
              {pending ? 'sending…' : formatTime(message.created_at)}
            </time>
            {own && sent && <CheckIcon size={12} />}
          </div>
        )}
      </div>
    </div>
  )

  async function commitEdit() {
    const next = draft.trim()
    if (!next || next === (message.body || '').trim()) {
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      await onEdit?.(message, { body: next })
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  async function commitDelete() {
    setBusy(true)
    try {
      await onDelete?.(message)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }
}

/**
 * A moderator deleting someone else's message gets different copy: the author
 * sees the message vanish with no notice, so the moderator is confirming on
 * their behalf. Edit never takes this path — only the author can edit.
 */
function ConfirmDelete({ senderName, moderating, busy, onCancel, onConfirm }) {
  return (
    <div className="chat-inline-editor">
      <p className="chat-bubble-text" style={{ color: 'var(--chat-danger)', fontWeight: 650 }}>
        {moderating
          ? `Delete this message posted by ${senderName}? This cannot be undone from their view.`
          : 'Delete this message? This cannot be undone.'}
      </p>
      <div className="chat-inline-editor-actions">
        <button type="button" className="chat-btn chat-btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="chat-btn chat-btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
