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

// A 401 means the session is gone (expired token, or "No token provided" because
// local storage was cleared). Clear it and bounce to the login screen so the
// user is never left staring at a dead panel.
function redirectToLogin() {
  try {
    if (window.location.pathname !== '/login') window.location.assign('/login')
  } catch { /* not running in a browser */ }
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
      clearSession(options._prefix || 'ucs')
      redirectToLogin()
      const e = new Error(err.message || (token ? 'Session expired. Please login again.' : 'Invalid credentials'))
      // Status must be attached on this path too, not only on !res.ok below.
      // Without it a 401 reaches callers as an untyped Error and every
      // `err.status === 401` check silently fails.
      e.status = 401
      throw e
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      const msg = String(err.message || `Request failed: ${res.status}`)
      if (msg.toLowerCase().includes('required fields are missing')) return { message: msg }
      const e = new Error(msg)
      e.status = res.status
      // A 404 whose body is not JSON is Express's default "Cannot GET /path":
      // the route is not mounted on this server. That is a deployment problem,
      // not a permissions problem, and the two must be distinguishable. A JSON
      // 404 is a refused or absent conversation; a non-JSON one is a missing
      // route. Reporting both as "your session expired" sends people to
      // re-login for no reason and hides the real cause.
      if (res.status === 404) {
        const type = res.headers.get('content-type') || ''
        e.routeMissing = !type.includes('application/json')
      }
      throw e
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

// Best-effort server-side logout: records the user's logout count + closes the
// CRM login session. Safe to call even if it fails (local session is cleared
// regardless).
export async function logout() {
  return api('/auth/logout', { method: 'POST', body: JSON.stringify({}), _prefix: 'ucs' })
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
