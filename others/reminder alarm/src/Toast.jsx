import { useState, useCallback } from 'react'

let toastId = 0
let addToastFn = null

export function toast(message, type = 'info', duration = 3000) {
  if (addToastFn) addToastFn({ id: ++toastId, message, type, duration })
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([])

  addToastFn = useCallback((t) => {
    setToasts(prev => [...prev, t])
    setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== t.id))
    }, t.duration)
  }, [])

  return (
    <div style={{
      position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: t.type === 'success' ? '#16a34a' : t.type === 'error' ? '#dc2626' : '#1a1a2e',
          color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,.15)',
          whiteSpace: 'nowrap', pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {t.type === 'success' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
          {t.type === 'error' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
