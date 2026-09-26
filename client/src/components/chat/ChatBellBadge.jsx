/**
 * Unread pill for the host panel's navigation.
 *
 * The spec caps the display at `99+` and uses a muted style for a quiet room, so
 * a Community room that is simply quiet does not look like an alert. Rendered
 * host-side so each panel can drop it into whichever nav convention it uses.
 */
export default function ChatBellBadge({ count, quiet = false, max = 99 }) {
  const n = Number(count) || 0
  if (n <= 0) return null
  return (
    <span
      className="chat-nav-badge"
      data-quiet={quiet ? 'true' : 'false'}
      style={quiet ? { background: 'var(--chat-border)', color: 'var(--chat-muted)' } : undefined}
      aria-hidden="true"
    >
      {n > max ? `${max}+` : n}
    </span>
  )
}
