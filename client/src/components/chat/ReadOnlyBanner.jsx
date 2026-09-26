import { LockIcon } from './chatIcons'

/**
 * Screen 03 — read-only banner.
 *
 * Rendered only when there is no composer, which is the six read-only roles —
 * writers always get a composer, so this never appears for them. That matters
 * for the wording: everyone who sees this banner is also someone who cannot
 * open a Direct Message, so suggesting DMs here would point at a feature they
 * do not have. The banner just states the rule and stops.
 */
export default function ReadOnlyBanner() {
  return (
    <div className="chat-readonly" role="status">
      <span className="chat-readonly-icon">
        <LockIcon size={16} />
      </span>
      <span>
        <strong>Read-only community.</strong> Only Super Admin and Accounts can post
        messages here.
      </span>
    </div>
  )
}
