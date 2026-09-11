import { useState, useEffect, useCallback } from 'react'
import { API_BASE as BASE } from '../lib/apiBase'

const TARGET_LABELS = {
  all: null,
  admin: 'Admin',
  accounts: 'Accounts',
  hr: 'HR',
  recruiter: 'Recruiter',
  fro: 'FRO',
  event_head: 'Event Head',
}

function getToken() {
  try { return localStorage.getItem('ucs_token') } catch { return null }
}

function getRole() {
  try {
    const u = localStorage.getItem('ucs_user')
    if (u) return JSON.parse(u).role
  } catch { return null }
}

export default function RecentNotices({ limit = 5, title = 'Recent Notices', containerStyle }) {
  return null;
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [editForms, setEditForms] = useState({})
  const [savingId, setSavingId] = useState(null)
  const role = getRole()
  const isAdmin = role === 'super_admin'

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }

    const params = role ? `?target_role=${role}` : ''
    fetch(`${BASE}/notices${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => {
        setNotices(Array.isArray(d) ? d.slice(0, limit) : d?.data?.slice(0, limit) || [])
      })
      .catch((err) => { console.error('Error:', err.message); })
      .finally(() => setLoading(false))
  }, [limit, role])

  const handleDelete = async (id) => {
    const token = getToken()
    if (!token) return
    setDeletingId(id)
    try {
      const res = await fetch(`${BASE}/notices/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        setNotices(prev => prev.filter(n => n.id !== id))
      }
    } catch {}
    setDeletingId(null)
  }

  const toggleEditMode = useCallback(() => {
    setEditMode(prev => {
      if (!prev) {
        const forms = {}
        notices.forEach(n => { forms[n.id] = { title: n.title, content: n.content } })
        setEditForms(forms)
      }
      return !prev
    })
  }, [notices])

  const handleEditChange = (id, field, value) => {
    setEditForms(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const handleSave = async (id) => {
    const token = getToken()
    if (!token) return
    setSavingId(id)
    try {
      const res = await fetch(`${BASE}/notices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(editForms[id])
      })
      if (res.ok) {
        setNotices(prev => prev.map(n => n.id === id ? { ...n, ...editForms[id] } : n))
      }
    } catch {}
    setSavingId(null)
  }

  if (loading) return null

  const cardStyle = {
    background: 'var(--paper, #fff)',
    border: '1px solid var(--line, #e2e8f0)',
    borderRadius: 14,
    padding: '18px 20px',
    boxShadow: '0 1px 2px rgba(30,77,59,0.04), 0 6px 18px -10px rgba(30,77,59,0.08)',
    ...containerStyle,
  }

  const editBtn = {
    background: editMode ? '#dcfce7' : '#f1f5f9',
    border: 'none', cursor: 'pointer',
    width: 30, height: 30, borderRadius: 8,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: editMode ? '#15803d' : '#64748b', transition: 'all .15s'
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
            background: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(22,163,74,0.25)',
          }}>
            <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 16 }}>campaign</span>
          </span>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--ink, #0f172a)', letterSpacing: '-.01em' }}>{title}</h3>
          {notices.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: '#15803d',
              background: '#dcfce7', borderRadius: 99, padding: '2px 10px',
            }}>
              {notices.length}
            </span>
          )}
        </div>
        {isAdmin && notices.length > 0 && (
          <button
            onClick={toggleEditMode}
            title={editMode ? 'Done editing' : 'Edit notices'}
            style={editBtn}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{editMode ? 'check' : 'edit'}</span>
          </button>
        )}
      </div>

      {notices.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, margin: '18px 0 6px' }}>No notices yet</p>
      ) : (
        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 2 }}>
          {notices.map((n, i) => (
            <div key={n.id || i} style={{
              display: 'flex', gap: 10, padding: '11px 13px',
              borderRadius: 10, background: '#f8fafc', border: '1px solid #eef2f7', alignItems: 'flex-start',
              transition: 'border-color .15s, background .15s, box-shadow .15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(30,77,59,0.06)' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#eef2f7'; e.currentTarget.style.boxShadow = 'none' }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                background: i % 2 === 0 ? '#e8f5ee' : '#eff6ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-outlined" style={{ color: i % 2 === 0 ? '#16a34a' : '#3b82f6', fontSize: 17 }}>
                  {i % 2 === 0 ? 'notifications' : 'campaign'}
                </span>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                {isAdmin && editMode ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <input value={editForms[n.id]?.title || ''} onChange={e => handleEditChange(n.id, 'title', e.target.value)}
                      style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: 7, padding: '5px 9px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }}
                    />
                    <textarea value={editForms[n.id]?.content || ''} onChange={e => handleEditChange(n.id, 'content', e.target.value)} rows={2}
                      style={{ fontSize: 11.5, color: '#475569', border: '1px solid #cbd5e1', borderRadius: 7, padding: '5px 9px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
                    />
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', lineHeight: 1.35 }}>
                      {n.title}
                      {TARGET_LABELS[n.target_role] && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                          background: '#dcfce7', color: '#15803d', whiteSpace: 'nowrap',
                        }}>
                          {TARGET_LABELS[n.target_role]}
                        </span>
                      )}
                    </div>
                    {n.content && (
                      <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3, lineHeight: 1.5 }}>
                        {n.content.length > 120 ? n.content.slice(0, 120) + '\u2026' : n.content}
                      </div>
                    )}
                    {n.media_url && (() => {
                      const t = String(n.media_type || '').toLowerCase()
                      const u = String(n.media_url || '').toLowerCase()
                      const isImg = t.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/.test(u)
                      if (!isImg) return null
                      return <img src={n.media_url} alt="" style={{ marginTop: 6, width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 8, border: '1px solid #eef2f7' }} />
                    })()}
                    <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600, marginTop: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>schedule</span>
                      {n.created_at ? new Date(n.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                      {n.created_by_name && (
                        <span style={{ color: '#94a3b8', fontWeight: 500 }}>by {n.created_by_name}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
              {isAdmin && (editMode ? (
                <button
                  onClick={() => handleSave(n.id)}
                  disabled={savingId === n.id}
                  title="Save"
                  style={{
                    background: savingId === n.id ? '#dcfce7' : '#16a34a',
                    border: 'none', cursor: savingId === n.id ? 'wait' : 'pointer',
                    padding: '5px 11px', borderRadius: 7, flexShrink: 0, alignSelf: 'center',
                    color: '#fff', fontSize: 10.5, fontWeight: 700, fontFamily: 'inherit',
                    boxShadow: savingId === n.id ? 'none' : '0 2px 6px rgba(22,163,74,0.25)', transition: 'background .15s',
                  }}
                >
                  {savingId === n.id ? 'Saving' : 'Save'}
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(n)}
                  disabled={deletingId === n.id}
                  title="Delete notice"
                  style={{
                    width: 26, height: 26, padding: 0,
                    background: 'none', border: 'none', cursor: deletingId === n.id ? 'wait' : 'pointer',
                    borderRadius: 7, flexShrink: 0, alignSelf: 'center',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#cbd5e1', transition: 'all .15s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fef2f2' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.background = 'transparent' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
{deletingId === n.id ? 'hourglass_top' : 'delete'}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div onClick={() => setConfirmDelete(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1100, padding: '20px'
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#FFFFFF', width: '100%', maxWidth: '400px',
            borderRadius: '16px', boxShadow: '0 25px 60px rgba(0,0,0,0.15), 0 4px 20px rgba(0,0,0,0.08)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '28px 28px 20px', textAlign: 'center' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%', background: '#FEE2E2',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px'
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#EF4444' }}>delete</span>
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#111827' }}>
                Delete Notice?
              </h3>
              <p style={{ margin: 0, fontSize: '14px', color: '#6B7280', lineHeight: 1.5 }}>
                Are you sure you want to delete <strong style={{ color: '#111827' }}>"{confirmDelete.title}"</strong>? This action cannot be undone.
              </p>
            </div>
            <div style={{
              padding: '16px 28px 24px', display: 'flex', gap: '10px', justifyContent: 'center'
            }}>
              <button onClick={() => setConfirmDelete(null)} style={{
                padding: '10px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: 600,
                background: '#FFFFFF', color: '#111827', border: '1px solid #E5E7EB',
                cursor: 'pointer', flex: 1
              }}>Cancel</button>
              <button onClick={() => { handleDelete(confirmDelete.id); setConfirmDelete(null); }} style={{
                padding: '10px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: 600,
                background: '#EF4444', color: '#FFFFFF', border: 'none',
                cursor: 'pointer', flex: 1
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
