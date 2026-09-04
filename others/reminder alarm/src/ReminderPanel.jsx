import { useEffect, useRef, useState, useCallback } from 'react'
import { Route, Routes, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useUcs, RemProvider, useRem } from './store'
import { Icon } from './components'
import ToastContainer, { toast } from './Toast'
import {
  addReminder, updateReminder, deleteReminder, completeReminder, snoozeReminder,
  fetchReminderHistory, markAllNotificationsRead, markNotificationRead,
  importReminders,
} from './api'
import { exportToCSV, exportToExcel, daysLeft } from './helpers'
import AllReminders from './AllReminders'
import RemSettings from './Settings'
import { ReminderFormModal, HistoryModal, DeleteConfirmModal, ImportModal, NotificationPanel, AlarmToast } from './modals'

const PAGE_META = {
  '/rem': ['Reminder & Alarm', 'All Reminders', 'One table for every reminder, category filter, due date and renewal.'],
  '/rem/settings': ['Reminder & Alarm', 'Settings', 'Configure reminder defaults, alarms and notifications.'],
}

function alarmCheck(reminders, settings, onFire) {
  const now = new Date()
  const threshold = settings?.due_soon_threshold || 7
  for (const r of reminders) {
    if (r.completed_at || r.is_deleted) continue
    const dl = daysLeft(r.due_date)
    if (dl === null) continue
    if (!(r.reminder_enabled || r.alarm_enabled)) continue
    const dueToday = dl === 0
    const overdue = dl < 0
    const dueSoon = dl > 0 && dl <= threshold
    if (overdue) {
      onFire(r, 'OVERDUE')
    } else if (dueToday) {
      onFire(r, 'DUE_TODAY')
    } else if (dueSoon && r.reminder_enabled) {
      onFire(r, 'DUE_SOON')
    }
  }
}

function SidebarButton({ label, icon, active, onClick }) {
  return (
    <button
      className={`side-link ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <Icon name={icon} size={16} /> <span>{label}</span>
    </button>
  )
}

function PanelInner() {
  const { user, logout } = useUcs()
  const { reminders, loading, refresh, notifications, refreshNotifications, settings, activeFilter, setActiveFilter } = useRem()
  const location = useLocation()
  const navigate = useNavigate()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [formKey, setFormKey] = useState(0)
  const [historyId, setHistoryId] = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [alarmToasts, setAlarmToasts] = useState([])
  const firedRef = useRef(new Set())

  useEffect(() => { refresh(); refreshNotifications(); /* eslint-disable */ }, [])

  useEffect(() => {
    if (!reminders.length) return
    const check = () => {
      alarmCheck(reminders, settings, (r, type) => {
        const key = `${r.id}-${type}`
        if (firedRef.current.has(key)) return
        firedRef.current.add(key)
        setAlarmToasts(prev => {
          if (prev.some(t => t.reminderId === r.id && t.alarmType === type)) return prev
          return [...prev, { reminderId: r.id, reminder: r, alarmType: type }]
        })
      })
    }
    check()
    const interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [reminders, settings])

  const dismissAlarm = useCallback((key) => {
    setAlarmToasts(prev => prev.filter(t => `${t.reminderId}-${t.alarmType}` !== key))
  }, [])

  const onSettings = location.pathname.startsWith('/rem/settings')
  const meta = onSettings ? PAGE_META['/rem/settings'] : PAGE_META['/rem']
  const initials = (user?.name || user?.login_id || 'U').toString().split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  function openAdd() { setEditing(null); setFormKey(k => k + 1); setFormOpen(true) }
  function openEdit(c) { setEditing(c); setFormKey(k => k + 1); setFormOpen(true) }

  async function doDelete(c) {
    setDeleting(true)
    try {
      await deleteReminder(c.id)
      await refresh()
      toast('Reminder deleted successfully', 'success')
      setDeleteId(null)
    } catch (e) {
      toast(e.message || 'Failed to delete reminder', 'error')
    } finally { setDeleting(false) }
  }

  async function handleSaved() {
    setFormOpen(false); setEditing(null)
    try { await refresh() } catch { /* keep */ }
  }

  async function handleComplete(id) {
    try {
      const res = await completeReminder(id)
      await refresh()
      toast(res.message || 'Reminder completed', 'success')
      dismissAlarm(`${id}-OVERDUE`)
      dismissAlarm(`${id}-DUE_TODAY`)
      dismissAlarm(`${id}-DUE_SOON`)
    } catch (e) { toast(e.message || 'Failed', 'error') }
  }

  async function handleSnooze(id, minutes) {
    try {
      await snoozeReminder(id, minutes)
      await refresh()
      toast(`Snoozed for ${minutes} minutes`, 'success')
      dismissAlarm(`${id}-OVERDUE`)
      dismissAlarm(`${id}-DUE_TODAY`)
      dismissAlarm(`${id}-DUE_SOON`)
    } catch (e) { toast(e.message || 'Failed', 'error') }
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="rem-app">
      <ToastContainer />
      <div className="rem-shell">
        <aside className="rem-sidebar">
          <div className="rem-brand">
            <div className="mark">REM</div>
            <div><h1>Reminder & Alarm</h1><span>Management System</span></div>
          </div>
          <div className="rem-side-label">Navigation</div>
          <nav className="rem-nav">
            <SidebarButton
              label="Dashboard"
              icon="dashboard"
              active={!onSettings && activeFilter === ''}
              onClick={() => { setActiveFilter(''); navigate('/rem') }}
            />
            <div className="rem-side-label" style={{ marginTop: 8 }}>Reminders</div>
            <SidebarButton
              label="All Reminders"
              icon="list"
              active={!onSettings && activeFilter === ''}
              onClick={() => { setActiveFilter(''); navigate('/rem') }}
            />
            <div className="rem-side-label" style={{ marginTop: 8 }}>System</div>
            <SidebarButton
              label="Reminder Settings"
              icon="settings"
              active={onSettings}
              onClick={() => { navigate('/rem/settings') }}
            />
          </nav>
          <div className="rem-sidebar-footer">
            <div className="u">
              <div className="rem-avatar">{initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || user?.login_id}</div>
                <div style={{ fontSize: 11, opacity: .7 }}>{user?.department || user?.role}</div>
              </div>
            </div>
            <button className="logout-btn" onClick={logout}>Sign out</button>
          </div>
        </aside>

        <div className="rem-main">
          <header className="rem-topbar">
            <div>
              <div className="eyebrow">{meta[0]}</div>
              <h2>{meta[1]}</h2>
              <p>{meta[2]}</p>
            </div>
            <div className="rem-actions" style={{ position: 'relative' }}>
              <button className="rem-btn primary" onClick={openAdd}><Icon name="plus" size={14} /> Add Reminder</button>
              <button className="rem-btn" onClick={() => { exportToCSV(reminders.filter(r => !r.is_deleted)); toast('CSV exported', 'success') }}>Export CSV</button>
              <button className="rem-btn" onClick={() => { exportToExcel(reminders.filter(r => !r.is_deleted)); toast('Excel exported', 'success') }}>Export</button>
              <button className="rem-btn" onClick={() => setImportOpen(true)}>Import</button>
              <div style={{ position: 'relative' }}>
                <button className="notif-badge" onClick={() => setNotifOpen(!notifOpen)}>
                  <Icon name="bell" size={18} />
                  {unreadCount > 0 && <span className="notif-count">{unreadCount}</span>}
                </button>
                {notifOpen && (
                  <NotificationPanel
                    notifications={notifications}
                    onClose={() => setNotifOpen(false)}
                    onMarkRead={async (id) => { await markNotificationRead(id); await refreshNotifications() }}
                    onMarkAllRead={async () => { await markAllNotificationsRead(); await refreshNotifications() }}
                    onClickReminder={(id) => { setActiveFilter(''); navigate('/rem'); setNotifOpen(false) }}
                  />
                )}
              </div>
            </div>
          </header>

          <div className="rem-content">
            <Routes>
              <Route index element={<AllReminders onAdd={openAdd} onEdit={openEdit} onDelete={setDeleteId} onHistory={setHistoryId} onComplete={handleComplete} onSnooze={handleSnooze} />} />
              <Route path="settings" element={<RemSettings />} />
              <Route path="*" element={<Navigate to="/rem" replace />} />
            </Routes>
          </div>
        </div>
      </div>

      <ReminderFormModal key={formKey} open={formOpen} reminder={editing} onClose={() => { setFormOpen(false); setEditing(null) }} onSaved={handleSaved} />
      <HistoryModal reminderId={historyId} open={!!historyId} onClose={() => setHistoryId(null)} />
      <DeleteConfirmModal reminder={deleteId} deleting={deleting} onClose={() => { if (!deleting) setDeleteId(null) }} onConfirm={() => deleteId && doDelete(deleteId)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); refresh() }} />

      {alarmToasts.map(t => (
        <AlarmToast
          key={`${t.reminderId}-${t.alarmType}`}
          reminder={t.reminder}
          alarmType={t.alarmType}
          onDismiss={() => dismissAlarm(`${t.reminderId}-${t.alarmType}`)}
          onComplete={() => handleComplete(t.reminderId)}
          onSnooze={(min) => handleSnooze(t.reminderId, min)}
          onView={() => { setActiveFilter(''); navigate('/rem'); dismissAlarm(`${t.reminderId}-${t.alarmType}`) }}
        />
      ))}
    </div>
  )
}

export default function ReminderPanel() {
  return (
    <RemProvider>
      <PanelInner />
    </RemProvider>
  )
}
