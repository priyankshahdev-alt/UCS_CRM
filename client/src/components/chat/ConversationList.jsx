import { Avatar } from '../ui'
import { formatListTime } from './chatTime'
import { HashIcon, SearchIcon, PlusIcon, LockIcon } from './chatIcons'

/**
 * Screen 01 — conversation list.
 *
 * The Community room is pinned above the tabs and never filtered out, so a
 * read-only viewer (who has no DMs at all) sees one obvious room rather than an
 * empty list with a tab they cannot use.
 */
export default function ConversationList({
  conversations,
  activeId,
  onSelect,
  tab,
  onTab,
  filter,
  onFilter,
  loading,
  error,
  onRetry,
  canDm,
  onNewMessage,
  title,
  loadingNode,
}) {
  const community = conversations.find((c) => c.kind === 'group') || null
  const dms = conversations.filter((c) => c.kind === 'direct')
  const term = filter.trim().toLowerCase()

  const matches = (c) =>
    !term ||
    c.title.toLowerCase().includes(term) ||
    (c.last_message?.body || '').toLowerCase().includes(term)

  const shownDms = dms.filter((c) => (tab === 'direct' ? true : matches(c)))

  // The header always renders. Only the row area swaps, so the rail does not
  // flash from a bare skeleton to a titled list on every load.
  return (
    <>
      <div className="chat-rail-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 className="chat-rail-title" style={{ flex: 1 }}>
            {title}
          </h2>
          {canDm && (
            <button
              type="button"
              className="chat-btn chat-btn-primary"
              onClick={onNewMessage}
              aria-label="Start a new direct message"
            >
              <PlusIcon size={15} />
              New
            </button>
          )}
        </div>

        {canDm ? (
          <div className="chat-tabs" role="tablist" aria-label="Conversation filters">
            <button
              type="button"
              role="tab"
              className="chat-tab"
              aria-selected={tab === 'all'}
              onClick={() => onTab('all')}
            >
              All
            </button>
            <button
              type="button"
              role="tab"
              className="chat-tab"
              aria-selected={tab === 'direct'}
              onClick={() => onTab('direct')}
            >
              Direct
            </button>
          </div>
        ) : (
          <div className="chat-readonly" style={{ padding: '8px 10px', borderRadius: 8, fontSize: 12 }}>
            <span className="chat-readonly-icon">
              <LockIcon size={14} />
            </span>
            <span>Read-only · 1 community room</span>
          </div>
        )}

        {!loading && conversations.length > 1 && (
          <div className="chat-field">
            <span className="chat-field-icon">
              <SearchIcon size={15} />
            </span>
            <input
              type="search"
              value={filter}
              onChange={(e) => onFilter(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
          </div>
        )}
      </div>

      {loading ? (
        loadingNode
      ) : error ? (
        <div className="chat-state" role="alert" style={{ height: 'auto', padding: '32px 20px' }}>
          <p className="chat-state-title">Could not load conversations</p>
          <p className="chat-state-sub">{error}</p>
          <button type="button" className="chat-btn" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <div className="chat-list">
          {community && matches(community) && (
            <ConvoRow
              conversation={community}
              active={activeId === community.id}
              onSelect={onSelect}
            />
          )}

          {shownDms.map((c) => (
            <ConvoRow key={c.id} conversation={c} active={activeId === c.id} onSelect={onSelect} />
          ))}

          {conversations.length === 0 && (
            <div className="chat-state" style={{ height: 'auto', padding: '32px 20px' }}>
              <p className="chat-state-title">No conversations yet</p>
              <p className="chat-state-sub">
                {canDm
                  ? 'Start a direct message to open a private conversation.'
                  : 'You will see community updates here.'}
              </p>
            </div>
          )}

          {conversations.length > 0 && !community && !shownDms.length && (
            <div className="chat-state" style={{ height: 'auto', padding: '28px 20px' }}>
              <p className="chat-state-sub">No conversations match “{filter.trim()}”.</p>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function ConvoRow({ conversation, active, onSelect }) {
  const last = conversation.last_message
  const isGroup = conversation.kind === 'group'
  const unread = conversation.unread_count || 0

  return (
    <button
      type="button"
      className="chat-convo"
      aria-current={active ? 'true' : 'false'}
      onClick={() => onSelect(conversation)}
    >
      <span className="chat-convo-avatar">
        {isGroup ? (
          <span
            className="avatar"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'var(--chat-navy)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-hidden="true"
          >
            <HashIcon size={20} />
          </span>
        ) : (
          <Avatar name={conversation.title} size={40} />
        )}
      </span>

      <span className="chat-convo-body">
        <span className="chat-convo-top">
          <span className="chat-convo-name">
            {isGroup ? 'Community' : conversation.title}
            {isGroup && (
              <span className="chat-bubble-role" style={{ marginLeft: 6 }}>
                {conversation.member_count} members
              </span>
            )}
          </span>
        </span>
        <span className="chat-convo-preview">
          {last ? (
            <>
              {!isGroup && <strong>{last.sender_name}: </strong>}
              {last.body}
            </>
          ) : (
            'No messages yet'
          )}
        </span>
      </span>

      <span className="chat-convo-meta">
        {last && <span className="chat-convo-time">{formatListTime(last.created_at)}</span>}
        {unread > 0 && (
          <span className="chat-convo-unread" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </span>

      <span className="chat-sr">
        {isGroup ? 'Community room' : `Direct message with ${conversation.title}`}
        {unread > 0 ? `, ${unread} unread` : ''}
      </span>
    </button>
  )
}
