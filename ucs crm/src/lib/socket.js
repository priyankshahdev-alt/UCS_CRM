import { io } from 'socket.io-client'
import { API_BASE } from './apiBase'

let socket = null

function getBaseUrl() {
  const override = import.meta.env.VITE_SOCKET_URL
  if (override) return override
  return API_BASE.replace(/\/api\/?$/, '')
}

function getToken() {
  try { return localStorage.getItem('ucs_token') } catch { return null }
}

export function getSocket() {
  if (socket) return socket
  socket = io(getBaseUrl(), {
    transports: ['websocket'],
    auth: { token: getToken() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  })
  return socket
}

export function onDbChange({ table, event = '*', filter, onInsert, onUpdate, onDelete }) {
  const s = getSocket()
  const handler = (payload) => {
    if (!payload) return
    if (table && payload.table !== table) return
    if (event !== '*' && event !== payload.eventType) return
    if (typeof filter === 'function' && !filter(payload)) return
    if (payload.eventType === 'INSERT' && onInsert) onInsert(payload.new, payload)
    if (payload.eventType === 'UPDATE' && onUpdate) onUpdate(payload.new, payload.old, payload)
    if (payload.eventType === 'DELETE' && onDelete) onDelete(payload.old, payload)
  }
  s.on('db:change', handler)
  return () => s.off('db:change', handler)
}

export function onFroAction(handler) {
  const s = getSocket()
  s.on('fro:action', handler)
  return () => s.off('fro:action', handler)
}

export function onFroBroadcast(handler) {
  const s = getSocket()
  s.on('fro:broadcast', handler)
  return () => s.off('fro:broadcast', handler)
}
