import { AlertIcon, InboxIcon, LockIcon, RetryIcon } from './chatIcons'

/**
 * One component for every "there is nothing to show right now" state, so
 * loading, empty, error and locked all look like the same family and never
 * like a broken pane.
 */
export function ChatState({
  kind = 'empty',
  title,
  sub,
  actionLabel,
  onAction,
  icon,
}) {
  const Icon =
    icon || (kind === 'error' ? AlertIcon : kind === 'locked' ? LockIcon : InboxIcon)

  return (
    <div className="chat-state" role={kind === 'error' ? 'alert' : 'status'}>
      <div
        className="chat-state-icon"
        style={kind === 'error' ? { background: '#FEF2F2', color: 'var(--chat-danger)' } : undefined}
      >
        <Icon size={22} />
      </div>
      {title && <p className="chat-state-title">{title}</p>}
      {sub && <p className="chat-state-sub">{sub}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          className={kind === 'error' ? 'chat-btn' : 'chat-btn chat-btn-ghost'}
          onClick={onAction}
          style={{ marginTop: 4 }}
        >
          {kind === 'error' && <RetryIcon size={15} />}
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/** Skeleton rows shown while the first page of a thread is in flight. */
export function ChatThreadSkeleton({ rows = 7 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="chat-skel" key={i}>
          <div className="chat-skel-bar" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
          <div
            className="chat-skel-bar"
            style={{ width: `${[46, 62, 38, 55, 70, 42, 50, 64][i % 8]}%`, height: 28 }}
          />
        </div>
      ))}
    </div>
  )
}
