import { useUcs } from '../../store'
import { api } from '../../api/auth'

export function useBeneficiaries() {
  const { user } = useUcs()
  return user
}

export async function apiGet(path) {
  const res = await api(path)
  return res
}

// `opts` is optional and passed straight through to api(), so callers that need
// a longer deadline than the 120s default (bulk imports, exports) can ask for
// one without every other caller changing.
export async function apiPost(path, body, opts = {}) {
  const res = await api(path, { method: 'POST', body: JSON.stringify(body), _prefix: 'ucs', ...opts })
  return res
}

export async function apiPatch(path, body) {
  const res = await api(path, { method: 'PATCH', body: JSON.stringify(body), _prefix: 'ucs' })
  return res
}

export async function apiPut(path, body) {
  const res = await api(path, { method: 'PUT', body: JSON.stringify(body), _prefix: 'ucs' })
  return res
}

export async function apiDelete(path) {
  const res = await api(path, { method: 'DELETE', _prefix: 'ucs' })
  return res
}
