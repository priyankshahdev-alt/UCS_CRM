import { API_BASE } from './config'

const TOKEN_KEY = 'reminder_alarm_token'
const USER_KEY = 'reminder_alarm_user'

export function setSession(token, user) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function getUser() {
  try { const d = localStorage.getItem(USER_KEY); return d ? JSON.parse(d) : null }
  catch { return null }
}

export async function request(method, path, body) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(String(data.message || 'Request failed'))
  }
  return data
}

export async function login(identifier, password) {
  const worker = await request('POST', 'auth/login', { identifier, password })
  const user = worker.user || {}
  const fullUser = {
    ...user,
    id: user.id || worker.id,
    login_id: user.login_id || user.email || identifier,
    role: worker.role || user.role,
    department: user.department,
    name: user.name || user.login_id || identifier,
  }
  return { token: worker.token, user: fullUser }
}

export async function fetchReminders() {
  return request('GET', 'reminders')
}
export async function fetchReminder(id) {
  return request('GET', `reminders/${id}`)
}
export async function addReminder(payload) {
  return request('POST', 'reminders', payload)
}
export async function updateReminder(id, payload) {
  return request('PUT', `reminders/${id}`, payload)
}
export async function deleteReminder(id) {
  return request('DELETE', `reminders/${id}`)
}
export async function completeReminder(id) {
  return request('POST', `reminders/${id}/complete`)
}
export async function snoozeReminder(id, minutes) {
  return request('POST', `reminders/${id}/snooze`, { minutes })
}
export async function fetchReminderHistory(id) {
  return request('GET', `reminders/${id}/history`)
}
export async function fetchNotifications() {
  return request('GET', 'reminders/notifications')
}
export async function fetchUnreadNotifications() {
  return request('GET', 'reminders/notifications?unread=true')
}
export async function fetchReminderNotifications(id) {
  return request('GET', `reminders/${id}/notifications`)
}
export async function markNotificationRead(id) {
  return request('POST', `reminders/notifications/${id}`)
}
export async function markAllNotificationsRead() {
  return request('POST', 'reminders/notifications/mark-all-read')
}
export async function deleteNotification(id) {
  return request('DELETE', `reminders/notifications/${id}`)
}
export async function fetchSettings() {
  return request('GET', 'reminders/settings')
}
export async function saveSettings(payload) {
  return request('POST', 'reminders/settings', payload)
}
export async function importReminders(rows) {
  return request('POST', 'reminders/import', { rows })
}