/**
 * Chat identity + capability resolution.
 *
 * Two different login flows feed the eight panels, and their tokens are not
 * shaped the same: the Accounts session carries little more than an id, while
 * most other panels carry name/email. So every display name here goes through a
 * fallback chain instead of trusting a single field.
 *
 * Capability derivation is purely for rendering. Hiding the composer is a
 * courtesy — the server is the only thing that actually enforces the matrix.
 */

export const CHAT_WRITER_ROLES = ['super_admin', 'accounts']

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  accounts: 'Accounts',
  admin: 'Admin',
  hr: 'HR',
  recruiter: 'Recruiter',
  fro: 'FRO',
  event_head: 'Event Head',
  // authController.js maps department 'digital' (or anything containing
  // 'develop') to role 'digital'. The old key was 'developers', which never
  // matched a real token, so the label fell back to the raw string.
  digital: 'Developer',
  developers: 'Developer',
  worker: 'Worker',
}

export function normalizeChatRole(role) {
  if (!role) return ''
  const s = String(role).trim().toLowerCase()
  if (s === 'accountant') return 'accounts'
  if (s === 'superadmin' || s === 'super admin') return 'super_admin'
  if (s === 'ngo admin' || s === 'ngo_admin') return 'admin'
  if (s === 'developer' || s === 'dev' || s === 'dev-panel') return 'developers'
  if (s === 'event head' || s === 'event-head') return 'event_head'
  if (s === 'hr-recruiter') return 'recruiter'
  return s
}

export function roleLabel(role) {
  const r = normalizeChatRole(role)
  return ROLE_LABELS[r] || r || 'Staff'
}

function pickName(user) {
  if (!user) return ''
  return (
    user.name ||
    user.full_name ||
    user.fullName ||
    user.display_name ||
    user.username ||
    user.user_name ||
    user.email ||
    ''
  )
}

function pickUid(user) {
  if (!user) return ''
  return String(
    user.id ?? user.uid ?? user.user_id ?? user.worker_id ?? user.uuid ?? ''
  )
}

/**
 * @param {object|null} user - session user from `useUcs()`
 * @returns {{uid:string,name:string,role:string,roleLabel:string,canPost:boolean,canDm:boolean,canModerate:boolean,isWriter:boolean,online:boolean}}
 */
export function resolveChatIdentity(user) {
  const role = normalizeChatRole(user?.role)
  const isWriter = CHAT_WRITER_ROLES.includes(role)
  const name = pickName(user).trim() || 'UCS Staff'
  return {
    uid: pickUid(user),
    name,
    role,
    roleLabel: roleLabel(role),
    // Posting, uploading, editing and deleting are all the same gate.
    canPost: isWriter,
    // Direct messages are writer-only; a read-only role has no DM targets.
    canDm: isWriter,
    // Superadmin can delete anyone's message. Editing stays sender-only.
    canModerate: role === 'super_admin',
    isWriter,
    online: true,
  }
}

/** 4000-char cap, matches the server-side rule in plan.md §6.1. */
export const CHAT_MAX_BODY = 4000
export const CHAT_MAX_FILE_BYTES = 25 * 1024 * 1024

export const CHAT_MIME_ALLOW = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-word': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
}

/** @returns {{ok:true,ext:string}|{ok:false,reason:string}} */
export function validateChatFile(file) {
  if (!file) return { ok: false, reason: 'No file selected' }
  if (file.size > CHAT_MAX_FILE_BYTES) {
    return { ok: false, reason: 'File is larger than 25 MB' }
  }
  const ext = CHAT_MIME_ALLOW[file.type]
  if (!ext) {
    return { ok: false, reason: 'That file type is not allowed' }
  }
  return { ok: true, ext }
}

export function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/')
}

export function humanFileSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
