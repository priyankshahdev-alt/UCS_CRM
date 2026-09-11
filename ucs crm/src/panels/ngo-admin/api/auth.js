import { api } from '../../../api/auth'

export async function login(email, password) {
  const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: email, password }), _prefix: 'ucs' })
  if (data.role !== 'admin' && data.role !== 'super_admin') throw new Error('Access denied. Admin account required.')
  return data
}

export function apiGet(path, opts = {}) { return api(path, { ...opts, _prefix: 'ucs' }) }
export function apiPost(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body), _prefix: 'ucs' }) }
export function apiPut(path, body) { return api(path, { method: 'PUT', body: JSON.stringify(body), _prefix: 'ucs' }) }
export function apiDelete(path) { return api(path, { method: 'DELETE', _prefix: 'ucs' }) }

export async function masterSearch(q) {
  return apiGet(`/ngo-admin/master-search?q=${encodeURIComponent(q)}`)
}

export async function getFroHourlyPerformance(params = {}) {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/ngo-admin/fro-hourly-performance${qs ? '?' + qs : ''}`)
}

export function notifyFro(workerId) {
  return apiPost('/ngo-admin/notify-fro', { workerId })
}

export function generateImpersonationCode() {
  return apiPost('/impersonation-codes/generate')
}

export function listImpersonationCodes() {
  return apiGet('/impersonation-codes')
}

export function listAllImpersonationCodes() {
  return apiGet('/impersonation-codes/all')
}

export { setSession, clearSession, getToken, getUser } from '../../../api/auth'
