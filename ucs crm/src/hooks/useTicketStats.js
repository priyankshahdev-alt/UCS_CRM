import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api/auth'

const EMPTY = {
  myRaisedOpen: 0,
  supportRaisedByMe: 0,
  devRaisedByMe: 0,
  supportOpen: 0,
  devOpen: 0,
  openForAction: 0,
}

// Fetches live ticket counts for panel dashboards. Optionally auto-refreshes
// so the numbers stay dynamic while the dashboard is open.
export default function useTicketStats({ refreshMs = 0 } = {}) {
  const [stats, setStats] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef(null)

  const refresh = useCallback(() => {
    return api('/dashboard/ticket-stats', { _prefix: 'ucs' })
      .then((data) => { if (data && typeof data === 'object' && 'myRaisedOpen' in data) setStats(data) })
      .catch((err) => { console.error('Ticket stats error:', err.message) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    if (refreshMs > 0) {
      timerRef.current = setInterval(refresh, refreshMs)
      return () => { clearInterval(timerRef.current) }
    }
    return () => {}
  }, [refresh, refreshMs])

  return { stats, loading, refresh }
}