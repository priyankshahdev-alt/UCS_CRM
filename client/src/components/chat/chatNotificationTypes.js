/**
 * The `type` value the backend writes into notification_log for a chat message.
 *
 * Mirrors backend/src/services/chatNotificationTypes.js. Duplicated as a literal
 * because the client and backend are separate deployables with no shared module
 * boundary; the contract test in backend/scripts/check-chat-contract.mjs asserts
 * the two files still agree, so drift fails a check rather than silently
 * breaking the drawer.
 */
export const CHAT_NOTIFICATION_TYPE = 'chat_message'
