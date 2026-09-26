import { useMemo } from 'react'
import { useUcs } from '../../store'
import { resolveChatIdentity } from './chatIdentity'
import { useUnreadCount } from './useChatRealtime'
import ChatBellBadge from './ChatBellBadge'

/**
 * Self-subscribing unread pill for a host panel's navigation row.
 *
 * Kept separate from the workspace so a panel can show the badge without
 * mounting chat at all. Renders nothing when the count is zero, so a quiet
 * Community room leaves the sidebar untouched.
 */
export default function ChatNavBadge({ quiet = false }) {
  const { user } = useUcs()
  const me = useMemo(() => resolveChatIdentity(user), [user])
  const { count } = useUnreadCount(me)
  return <ChatBellBadge count={count} quiet={quiet} />
}
