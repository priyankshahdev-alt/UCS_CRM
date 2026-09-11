import { createContext, useContext, useState, useCallback } from 'react'
import { login as apiLogin, setSession, clearSession, getToken, getUser, releaseWorkAs } from './api/auth'

const ROLE_ALIASES = {
  'hr': 'hr',
  'hr-recruiter': 'recruiter',
  'fro': 'fro',
  'accounts': 'accounts',
  'accountant': 'accounts',
  'admin': 'admin',
  'ngo admin': 'admin',
  'ngo_admin': 'admin',
  'super_admin': 'super_admin',
  'superadmin': 'super_admin',
  'master': 'master',
  'recruiter': 'recruiter',
  'telecaller': 'telecaller',
  'worker': 'worker',
  'event_head': 'event_head',
  'event manager': 'event_manager',
  'event_manager': 'event_manager',
  'event head': 'event_head',
  'whatsapp_crm': 'whatsapp_crm',
  'digital': 'digital',
  'developer': 'developers',
  'developers': 'developers',
  'agent': 'agent',
  'viewer': 'viewer',
}

const normalizeRole = (role) => {
  if (!role) return role
  const s = String(role).trim().toLowerCase()
  return ROLE_ALIASES[s] || s
}

const ALLOWED_ROLES = {
  super_admin: 'super_admin',
  admin: 'admin',
  hr: 'hr',
  accounts: 'accounts',
  whatsapp_crm: 'whatsapp_crm',
  recruiter: 'recruiter',
  telecaller: 'telecaller',
  fro: 'fro',
  worker: 'worker',
  digital: 'digital',
  developers: 'developers',
  event_head: 'event_head',
  event_manager: 'event_manager',
  'Event Manager': 'Event Manager',
  'Event Head': 'Event Head',
}

export const UcsContext = createContext(null)

export function UcsProvider({ children }) {
  const [user, setUser] = useState(() => getUser('ucs'))
  const [token, setToken] = useState(() => getToken('ucs'))

  const login = useCallback(async (identifier, password) => {
    const data = await apiLogin(identifier, password)
    const role = normalizeRole(data.role || data.user?.role)
    if (!role || !ALLOWED_ROLES[role]) {
      throw new Error('Access denied. Invalid role.')
    }
    const userData = data.user || { ...data }
    userData.role = role
    setSession('ucs', data.token, userData)
    setToken(data.token)
    setUser(userData)
    return { token: data.token, user: userData }
  }, [])

  const logout = useCallback(() => {
    try {
      const u = getUser('ucs');
      if (u?.id) releaseWorkAs().catch(() => {});
    } catch {}
    const keep = [];
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('nc_seen_v1') || k.startsWith('nc_bar_dismissed'))) {
          keep.push([k, localStorage.getItem(k)]);
        }
      }
    } catch {}
    localStorage.clear()
    for (const [k, v] of keep) {
      try { localStorage.setItem(k, v) } catch {}
    }
    clearSession('ucs')
    setToken(null)
    setUser(null)
  }, [])

  return (
    <UcsContext.Provider value={{ user, token, login, logout }}>
      {children}
    </UcsContext.Provider>
  )
}

export function useUcs() {
  const ctx = useContext(UcsContext)
  if (!ctx) throw new Error('useUcs must be used within UcsProvider')
  return ctx
}
