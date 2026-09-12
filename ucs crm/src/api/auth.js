import { API_BASE } from '../lib/apiBase'

const BASE = API_BASE

export function setSession(prefix, token, user) {
  localStorage.setItem(`${prefix}_token`, token)
  localStorage.setItem(`${prefix}_user`, JSON.stringify(user))
}

export function clearSession(prefix) {
  localStorage.removeItem(`${prefix}_token`)
  localStorage.removeItem(`${prefix}_user`)
}

export function getToken(prefix) {
  return localStorage.getItem(`${prefix}_token`)
}

export function getUser(prefix) {
  try { const d = localStorage.getItem(`${prefix}_user`); return d ? JSON.parse(d) : null }
  catch { return null }
}

export async function api(path, options = {}) {
  const token = getToken(options._prefix || 'ucs')
  const isFormData = options.body instanceof FormData
  const headers = { ...options.headers }
  if (!isFormData) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), options.timeout || 120000)
  const externalSignal = options.signal || null
  let combinedSignal = timeoutController.signal
  if (externalSignal) {
    if (typeof AbortSignal.any === 'function') {
      combinedSignal = AbortSignal.any([timeoutController.signal, externalSignal])
    } else {
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      timeoutController.signal.addEventListener('abort', onAbort, { once: true })
      externalSignal.addEventListener('abort', onAbort, { once: true })
      combinedSignal = controller.signal
    }
  }
  try {
    const res = await fetch(`${BASE}${path}`, { ...options, headers, signal: combinedSignal })
    if (res.status === 401) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      if (token) {
        clearSession(options._prefix || 'ucs')
      }
      throw new Error(err.message || (token ? 'Session expired. Please login again.' : 'Invalid credentials'))
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      const msg = String(err.message || `Request failed: ${res.status}`)
      if (msg.toLowerCase().includes('required fields are missing')) return { message: msg }
      throw new Error(msg)
    }
    if (options.raw) return res
    return res.json()
  } finally {
    clearTimeout(timeout)
  }
}

export async function login(identifier, password) {
  return api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
    _prefix: 'ucs',
  })
}

export async function impersonateFRO(workerId, code, imposterWorkerId, stations) {
  return api('/auth/impersonate', {
    method: 'POST',
    body: JSON.stringify({
      worker_id: workerId,
      code,
      imposter_worker_id: imposterWorkerId || undefined,
      stations: Array.isArray(stations) ? stations : undefined,
    }),
    _prefix: 'ucs',
  })
}

// Stations of the FRO we want to work as + live availability (who took what).
export async function getFroWorkAsStations(workerId) {
  return api(`/auth/fro-workers/${workerId}/stations`, { _prefix: 'ucs' })
}

// Release our active work-as sessions (Exit work-as).
export async function releaseWorkAs() {
  return api('/auth/work-as/release', { method: 'POST', body: JSON.stringify({}), _prefix: 'ucs' })
}

export async function generateImpersonationCode() {
  return api('/impersonation-codes/generate', {
    method: 'POST',
    body: JSON.stringify({}),
    _prefix: 'ucs',
  })
}

export async function getFroWorkersForImpersonation() {
  return api('/auth/fro-workers', { _prefix: 'ucs' })
}

export function isImpersonating() {
  const u = getUser('ucs')
  return !!(u && u.impersonation)
}

// Switch to an impersonated FRO session, remembering the original session so we
// can switch back.
export function startImpersonation(token, user) {
  const origToken = getToken('ucs')
  const origUser = getUser('ucs')
  if (origToken) localStorage.setItem('ucs_original_token', origToken)
  if (origUser) localStorage.setItem('ucs_original_user', JSON.stringify(origUser))
  setSession('ucs', token, user)
}

// Restore the pre-impersonation session.
export function exitImpersonation() {
  const t = localStorage.getItem('ucs_original_token')
  const u = localStorage.getItem('ucs_original_user')
  if (t) {
    setSession('ucs', t, u ? JSON.parse(u) : null)
  } else {
    clearSession('ucs')
  }
  localStorage.removeItem('ucs_original_token')
  localStorage.removeItem('ucs_original_user')
}
