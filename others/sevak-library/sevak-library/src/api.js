// Sevak Library public API client.
//
// Formerly talked to Supabase (storage uploads + RPCs). Now everything goes to
// the UCS CRM backend API host (api.beingsevak.org) — an absolute URL so the
// app works from any static host (Vercel, GitHub Pages, or /sevak-library on
// the API server itself). The backend sends CORS headers with origin '*', so
// cross-origin browser calls are allowed, and its preflight OPTIONS is handled.
// Admin endpoints require the CRM session (JWT); the public endpoints (submit,
// look up by ref, record payment, payment reminder) are open.
//
// Base URL rules:
//   - dev (`npm run dev`): use VITE_API_BASE as-is, defaulting to the relative
//     '/api/sevak-library' which the Vite dev server proxies to localhost:5000.
//   - prod build: only an ABSOLUTE override is trusted. A relative value would
//     POST to the static host (sevak-library.vercel.app/api/...) and 404, so we
//     fall back to the CRM API host no matter what the env says.
const ENV_BASE = import.meta.env.VITE_API_BASE || ''
const BASE = import.meta.env.DEV
  ? (ENV_BASE || '/api/sevak-library')
  : (/^https?:\/\//i.test(ENV_BASE)
      ? ENV_BASE.replace(/\/$/, '')
      : 'https://audio-diagnoses-ream.ngrok-free.dev/api/sevak-library')

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = j.message || j.error || `Request failed (${res.status})`
    const e = new Error(msg)
    e.status = res.status
    throw e
  }
  return j
}

function authHeaders() {
  const token = localStorage.getItem('ucs_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function generateRef() {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `SL-${ymd}-${rand}`
}

export async function submitApplication(values) {
  const fd = new FormData()
  const signature = typeof values.applicantSignature === 'string' ? values.applicantSignature : ''
  const hasSignature = signature.startsWith('data:image')
  for (const [key, value] of Object.entries(values || {})) {
    if (key === 'passportPhoto' || key === 'identityProofPhoto') continue
    // The drawn signature travels as a file (`signature`), never as a giant
    // base64 string inside the JSON `data` payload.
    if (key === 'applicantSignature') continue
    fd.append(key, value == null ? '' : String(value))
  }
  if (values.passportPhoto instanceof File) fd.append('passport', values.passportPhoto)
  if (values.identityProofPhoto instanceof File) fd.append('identity', values.identityProofPhoto)
  if (hasSignature) {
    const blob = await (await fetch(signature)).blob()
    fd.append('signature', blob, 'signature.png')
  }

  const j = await request('/applications', { method: 'POST', body: fd })
  return j.data
}

export async function recordPayment(ref, transactionId) {
  const j = await request('/applications/record-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, transactionId }),
  })
  return j.data
}

export async function getApplicationByRef(ref) {
  const j = await request(`/applications/by-ref/${encodeURIComponent(ref)}`)
  return j.data || null
}

// Photos are served through presigned URLs from the backend admin endpoints.
// The public app never needed direct file URLs; kept as a no-op for the
// (removed) standalone admin.
export async function getFileUrl() {
  return null
}

export async function resolvePhotoUrls(rows) {
  return rows.map(() => null)
}

export async function updateApplication(id, data, transactionId, photos = {}) {
  const hasFiles = photos.passport instanceof File || photos.identity instanceof File
  if (hasFiles) {
    const fd = new FormData()
    fd.append('data', JSON.stringify(data))
    if (transactionId) fd.append('transactionId', transactionId)
    if (photos.passport instanceof File) fd.append('passport', photos.passport)
    if (photos.identity instanceof File) fd.append('identity', photos.identity)
    const j = await request(`/applications/${id}`, { method: 'PUT', headers: authHeaders(), body: fd })
    return j.data
  }
  const j = await request(`/applications/${id}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, transactionId: transactionId || null }),
  })
  return j.data
}

export async function uploadApplicationPhoto() {
  // Photo replacement is now handled by updateApplication on the backend.
  return null
}

export async function deleteApplicationPhoto() {
  return null
}

export async function listCoupons() {
  const j = await request('/coupons', { headers: authHeaders() })
  return j.data || []
}

export async function createCoupon(values) {
  const j = await request('/coupons', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
  return j.data
}

export async function updateCoupon(id, values) {
  const j = await request(`/coupons/${id}`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
  return j.data
}

export async function deleteCoupon(id) {
  await request(`/coupons/${id}`, { method: 'DELETE', headers: authHeaders() })
}

export async function importMembers(rows) {
  const j = await request('/applications/import', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) })
  return j.data
}

export async function sendCouponEmail(couponId, applicationIds) {
  const j = await request(`/coupons/${couponId}/email`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ couponId, applicationIds }),
  })
  if (j.sent === false) throw new Error(j.error || 'Email could not be sent')
  return j
}

export async function rejectApplication(id, reason) {
  const j = await request(`/applications/${id}/reject`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason || '' }) })
  return j.data
}

export async function deleteApplication(row) {
  await request(`/applications/${row.id}`, { method: 'DELETE', headers: authHeaders() })
}

async function callEmailFunction(applicationId, type) {
  const j = await withTimeout(
    request(`/applications/${applicationId}/emails/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    25000
  )
  if (j.sent === false) throw new Error(j.error || 'Email could not be sent')
  return j
}

async function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Email service timed out. Try again.')), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export async function resendMembershipEmail(applicationId) {
  return callEmailFunction(applicationId, 'membership')
}

export async function sendPaymentReminder(applicationId, _alreadySent = false) {
  return withTimeout(
    request(`/applications/${applicationId}/emails/payment-reminder`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    25000
  )
}

export function exportApplicationsCsv(rows) {
  const headers = [
    'Reference', 'Status', 'Membership ID', 'Full Name', 'Email', 'Mobile',
    'Plan', 'Fee', 'Start Date', 'End Date', 'Identity Proof', 'Identity Number',
    'Transaction ID', 'Created At'
  ]
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  rows.forEach((r) => {
    lines.push(
      [
        r.ref, r.status, r.membership_id, r.full_name, r.email, r.mobile,
        r.membership_type, r.membership_fee, r.start_date, r.end_date,
        r.identity_proof_type, r.identity_number, r.transaction_id, r.created_at
      ].map(esc).join(',')
    )
  })
  return lines.join('\n')
}