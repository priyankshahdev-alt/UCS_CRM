import { createContext, useContext, useState, useEffect } from 'react'
import { getUser, clearSession, fetchReminders, fetchNotifications, fetchSettings } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children, initialUser }) {
  const [user, setUser] = useState(() => initialUser || getUser())

  const logout = () => {
    clearSession()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useUcs() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useUcs must be used within AuthProvider')
  return ctx
}

export const RemContext = createContext(null)

export function RemProvider({ children }) {
  const [reminders, setReminders] = useState([])
  const [loading, setLoading] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [settings, setSettings] = useState(null)
  const [activeFilter, setActiveFilter] = useState(() => {
    try { return sessionStorage.getItem('rem_active_filter') || '' } catch { return '' }
  })

  useEffect(() => {
    try { sessionStorage.setItem('rem_active_filter', activeFilter) } catch { /* ignore */ }
  }, [activeFilter])

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await fetchReminders()
      if (Array.isArray(data)) setReminders(data)
    } catch { /* keep current */ }
    finally { setLoading(false) }
  }

  const refreshNotifications = async () => {
    try {
      const data = await fetchNotifications()
      if (Array.isArray(data)) setNotifications(data)
    } catch { /* keep current */ }
  }

  const refreshSettings = async () => {
    try {
      const data = await fetchSettings()
      setSettings(data && data.id ? data : null)
    } catch { /* keep current */ }
  }

  return (
    <RemContext.Provider value={{
      reminders, setReminders, loading, refresh,
      notifications, setNotifications, refreshNotifications,
      settings, setSettings, refreshSettings,
      activeFilter, setActiveFilter,
    }}>
      {children}
    </RemContext.Provider>
  )
}

export function useRem() {
  const ctx = useContext(RemContext)
  if (!ctx) throw new Error('useRem must be used within RemProvider')
  return ctx
}
