import { useState, useEffect, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  CATEGORIES, PRIORITIES, EVENT_STATUSES, fetchEventById, updateEvent, updateEventStatus, deleteEvent,
  fetchWorkspaceNgos, fetchSectors, fetchActivities, fetchMedia,
  fetchEventBannerObjectUrl, fetchMediaViewObjectUrl,
} from '../store'
import { SectionCard, Badge, Empty, StatusPill } from '../components/ui'
import EditBannerModal from '../components/EditBannerModal'
import VoluntaryPicker from '../components/VoluntaryPicker'
import { DistrictSelect, StateSelect } from '../../../components/LocationSelect'
import { stateForDistrict, districtsOfState as districtsOf } from '../../../utils/indiaLocations'

function AuthImage({ src, eventId, mediaId, kind, alt, height, fit = 'cover', radius = 12 }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    if (!src && !eventId) { setStatus('empty'); setUrl(''); return }
    setStatus('loading'); setUrl('')
    ;(async () => {
      try {
        if (eventId && kind === 'banner') objectUrl = await fetchEventBannerObjectUrl(eventId)
        else if (eventId && mediaId != null) objectUrl = await fetchMediaViewObjectUrl(eventId, mediaId)
        else if (src) { if (!cancelled) { setUrl(src); setStatus('ok') } return }
        else throw new Error('nothing to load')
        if (cancelled) { URL.revokeObjectURL(objectUrl); return }
        setUrl(objectUrl)
        setStatus('ok')
      } catch {
        if (cancelled) return
        if (src) { setUrl(src); setStatus('ok') }
        else setStatus('error')
      }
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src, eventId, mediaId, kind])

  const box = {
    width: '100%', height, borderRadius: radius, overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
    padding: status === 'ok' ? 0 : 10, fontSize: 11.5, color: 'var(--eh-ink-soft)',
    background: status === 'ok' ? 'transparent' : 'var(--eh-tint-1)',
  }
  if (status === 'loading') return <div style={box}>Loading image…</div>
  if (status !== 'ok') return <div style={box}>{status === 'error' ? 'Image could not be loaded' : 'No image'}</div>
  return (
    <img
      src={url}
      alt={alt || ''}
      onError={() => setStatus('error')}
      style={{ width: '100%', height, objectFit: fit, display: 'block', borderRadius: radius }}
    />
  )
}

function InfoField({ label, children, wide }) {
  const empty = children === '' || children === null || children === undefined
  return (
    <div style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--eh-ink-faint)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--eh-ink)', fontWeight: 550, lineHeight: 1.45, wordBreak: 'break-word' }}>{empty ? '—' : children}</div>
    </div>
  )
}

function InfoGrid({ children, min = 150 }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: '14px 18px' }}>{children}</div>
}

export default function EventDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [event, setEvent] = useState(null)
  const [media, setMedia] = useState([])
  const [ngos, setNgos] = useState([])
  const [sectors, setSectors] = useState([])
  const [allActivities, setAllActivities] = useState([])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editBanner, setEditBanner] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([fetchEventById(id).catch(() => null), fetchMedia(id).catch(() => [])])
      .then(([ev, med]) => {
        setEvent(ev || null)
        setMedia(med || [])
      })
      .catch(e => { console.error('EventDetail fetch:', e); setEvent(null) })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    Promise.all([
      fetchWorkspaceNgos().catch(() => []),
      fetchSectors().catch(() => []),
      fetchActivities().catch(() => []),
    ]).then(([n, s, a]) => { setNgos(n || []); setSectors(s || []); setAllActivities(a || []) })
    load()
  }, [id])

  // Deep-link into edit mode (e.g. planner "Edit Event" button).
  useEffect(() => {
    if (event && !editing && searchParams.get('edit') === '1') startEdit()
  }, [event])

  const ngoId = form.ngo_id ? String(form.ngo_id) : (editing ? '' : '')
  const sectorId = form.sector_id ? String(form.sector_id) : (editing ? '' : '')

  const relevantSectors = useMemo(() => {
    if (!editing) return []
    const ids = new Set()
    for (const a of allActivities) {
      if (a.ngo_id == null || String(a.ngo_id) === ngoId) ids.add(String(a.sector_id))
    }
    let list = sectors.filter(s => ids.has(String(s.id)))
    if (sectorId && !list.some(s => String(s.id) === sectorId)) {
      const cur = sectors.find(s => String(s.id) === sectorId)
      if (cur) list = [cur, ...list]
    }
    return list
  }, [sectors, allActivities, editing, ngoId, sectorId])

  const relevantActivities = useMemo(() => {
    if (!editing) return []
    let list = allActivities.filter(a =>
      String(a.sector_id) === sectorId &&
      (a.ngo_id == null || String(a.ngo_id) === ngoId)
    )
    if (form.activity_id && !list.some(a => String(a.id) === String(form.activity_id))) {
      const cur = allActivities.find(a => String(a.id) === String(form.activity_id) && String(a.sector_id) === sectorId)
      if (cur) list = [cur, ...list]
    }
    return list
  }, [allActivities, editing, ngoId, sectorId, form.activity_id])

  const startEdit = () => {
    setForm({
      name: event.name || '', category: event.category || '', ngo_id: event.ngo_id != null ? String(event.ngo_id) : '',
      sector_id: event.sector_id != null ? String(event.sector_id) : '', activity_id: event.activity_id != null ? String(event.activity_id) : '',
      date: event.date || '', start_time: event.start_time || '', end_time: event.end_time || '',
      priority: event.priority || 'Medium', venue: event.venue || '', gps_location: event.gps_location || '',
      district: event.district || '', state: event.state || '', organizer: event.organizer || '',
      event_manager: event.event_manager || '', coordinator: event.coordinator || '',
      csr_partner: event.csr_partner || '', donor: event.donor || '', funding_source: event.funding_source || '',
      expected_beneficiaries: event.expected_beneficiaries || '', budget: event.budget || '',
      description: event.description || '', notes: event.notes || '',
      volunteers: Array.isArray(event.volunteers) ? event.volunteers : [],
    })
    setError('')
    setEditing(true)
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => {
      const next = { ...prev, [name]: value }
      if (name === 'ngo_id') { next.sector_id = ''; next.activity_id = '' }
      if (name === 'sector_id') next.activity_id = ''
      return next
    })
  }

  // District and State come from fixed lists, so keep the pair consistent rather
  // than letting a district sit under the wrong state. Same rule as the Create
  // form: a district fills in its state when the name is unique to one state
  // (Bilaspur / Hamirpur / Pratapgarh exist in two, so those need a manual pick).
  const pickDistrict = (district) => {
    setForm(prev => {
      const next = { ...prev, district }
      if (district) {
        const state = stateForDistrict(district)
        if (state) next.state = state
        else if (prev.state && !districtsOf(prev.state).includes(district)) next.state = ''
      }
      return next
    })
  }

  const pickState = (state) => {
    setForm(prev => {
      const next = { ...prev, state }
      // A district from another state would be wrong, so drop it.
      if (state && prev.district && !districtsOf(state).includes(prev.district)) next.district = ''
      return next
    })
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true); setError('')
    if (!form.name || !form.date) { setError('Event name and date are required'); setSaving(false); return }
    if (!form.ngo_id || !form.sector_id || !form.activity_id) {
      setError('NGO, Sector and Activity are required for the event'); setSaving(false); return
    }
    if (form.start_time && form.end_time && form.end_time < form.start_time) {
      setError('End time must be after start time'); setSaving(false); return
    }
    try {
      const payload = { ...form, ngo_id: form.ngo_id, sector_id: Number(form.sector_id), activity_id: Number(form.activity_id) }
      for (const k of Object.keys(payload)) {
        if (payload[k] === '' || payload[k] === null || payload[k] === undefined) payload[k] = null
      }
      const updated = await updateEvent(id, payload)
      setEvent({ ...event, ...updated })
      setEditing(false)
    } catch (err) { setError(err.message || 'Failed to save event'); console.error('EventDetail save:', err) }
    finally { setSaving(false) }
  }

  const handleStatus = async (status) => {
    try {
      await updateEventStatus(id, status)
      setEvent({ ...event, status })
    } catch (err) { alert('Failed to update status: ' + (err.message || 'Unknown error')) }
  }

  const handleDelete = async () => {
    setDeleting(true); setDeleteError('')
    try {
      await deleteEvent(id)
      navigate('/event-head/events?deleted=1')
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete the event')
      setDeleting(false)
    }
  }

  // Build the "Daily Event Planning Form" PDF for this event. jspdf is imported
  // lazily so it stays out of the main bundle until the button is used.
  const handleDownloadPdf = async () => {
    try {
      setDownloading(true)
      const { buildEventPlanningPdf } = await import('../components/eventPlanningPdf.mjs')
      const doc = buildEventPlanningPdf(event)
      const base = String(event.name || 'event-planning-form').trim().replace(/[^\w\-]+/g, '_').slice(0, 60) || 'event-planning-form'
      doc.save(`${base}.pdf`)
    } catch (err) {
      console.error('Event planner PDF:', err)
      alert('Could not create the PDF: ' + (err.message || 'Unknown error'))
    } finally {
      setDownloading(false)
    }
  }

  if (loading) return <div className="loading">Loading event...</div>
  if (!event) return (
    <div className="empty-state">
      <h3>Event not found</h3>
      <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/event-head/events')}>Back to Events</button>
    </div>
  )

  const timeLabel = (s, e) => {
    if (s && e) return `${String(s).slice(0,5)} – ${String(e).slice(0,5)}`
    if (s) return String(s).slice(0,5)
    return '—'
  }
  const money = (v) => v == null || v === '' ? '—' : '₹' + Number(v).toLocaleString()
  const fmtDate = (v) => {
    if (!v) return '—'
    const d = String(v).slice(0, 10)
    const dt = new Date(d + 'T00:00:00')
    return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const locationLabel = [event.district, event.state].filter(Boolean).join(', ') || '—'
  const bannerMedia = media.find(m => m.media_type === 'Banner')

  return (
    <>
      <div className="eh-page-head">
        <div>
          <button className="eh-btn eh-btn-ghost" style={{ paddingLeft: 0, marginBottom: 6 }} onClick={() => navigate('/event-head/events')}>← Events</button>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--eh-ink)' }}>Event Details</h2>
        </div>
        {!editing && (
          <div className="eh-actions">
            {event.status !== 'Completed' && (
              <button className="eh-btn" style={{ color: 'var(--eh-success)', borderColor: 'var(--eh-success-soft)' }} onClick={() => handleStatus('Completed')}>Mark Completed</button>
            )}
            <select className="eh-select" value={event.status} onChange={e => handleStatus(e.target.value)}>
              {EVENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="eh-btn" onClick={startEdit}>Edit</button>
            <button className="eh-btn" onClick={handleDownloadPdf} disabled={downloading}>
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
            <button className="eh-btn" onClick={() => navigate('/event-head/reports')}>Report</button>
            <button className="eh-btn" style={{ color: 'var(--eh-danger)', borderColor: 'var(--eh-danger)' }} onClick={() => { setDeleteError(''); setConfirmDelete(true) }}>Delete</button>
          </div>
        )}
      </div>

      {editing ? (
        <SectionCard title="Edit Event">
          <form onSubmit={handleSave}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--eh-ink-soft)', marginBottom: 12 }}>Program Context</div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>NGO *</label><select name="ngo_id" value={form.ngo_id} onChange={handleChange} required>
                <option value="">Select NGO</option>
                {ngos.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select></div>
              <div className="field"><label>Sector *</label><select name="sector_id" value={form.sector_id} onChange={handleChange} required>
                <option value="">Select sector</option>
                {relevantSectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Activity *</label><select name="activity_id" value={form.activity_id} onChange={handleChange} required>
                <option value="">Select activity</option>
                {relevantActivities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></div>
              <div className="field"><label>Category</label><select name="category" value={form.category} onChange={handleChange}>
                <option value="">Select category</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select></div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--eh-ink-soft)', margin: '16px 0 12px' }}>Event Details</div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Event Name *</label><input name="name" value={form.name} onChange={handleChange} required /></div>
              <div className="field"><label>Event Date *</label><input type="date" name="date" value={form.date} onChange={handleChange} required /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Start Time</label><input type="time" name="start_time" value={form.start_time} onChange={handleChange} /></div>
              <div className="field"><label>End Time</label><input type="time" name="end_time" value={form.end_time} onChange={handleChange} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Priority</label><select name="priority" value={form.priority} onChange={handleChange}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select></div>
              <div className="field"><label>Venue</label><input name="venue" value={form.venue} onChange={handleChange} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>GPS Location</label><input name="gps_location" value={form.gps_location} onChange={handleChange} /></div>
              <div className="field"><label>District</label><DistrictSelect value={form.district} onChange={pickDistrict} ariaLabel="District" /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>State</label><StateSelect value={form.state} onChange={pickState} ariaLabel="State" /></div>
              <div className="field"><label>Organizer</label><input name="organizer" value={form.organizer} onChange={handleChange} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Event Manager</label><input name="event_manager" value={form.event_manager} onChange={handleChange} /></div>
              <div className="field"><label>Coordinator</label><input name="coordinator" value={form.coordinator} onChange={handleChange} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>CSR Partner</label><input name="csr_partner" value={form.csr_partner} onChange={handleChange} /></div>
              <div className="field"><label>Donor</label><input name="donor" value={form.donor} onChange={handleChange} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Funding Source</label><input name="funding_source" value={form.funding_source} onChange={handleChange} /></div>
              <div className="field"><label>Expected Beneficiaries</label><input type="number" name="expected_beneficiaries" value={form.expected_beneficiaries} onChange={handleChange} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Budget (₹)</label><input type="number" name="budget" value={form.budget} onChange={handleChange} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Description</label><textarea name="description" value={form.description} onChange={handleChange} rows={3} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--eh-line)', borderRadius: 'var(--radius-sm)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} /></div>
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="field"><label>Notes</label><textarea name="notes" value={form.notes} onChange={handleChange} rows={2} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--eh-line)', borderRadius: 'var(--radius-sm)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} /></div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--eh-ink-soft)', margin: '16px 0 12px' }}>Voluntary</div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <VoluntaryPicker ngoId={form.ngo_id} value={Array.isArray(form.volunteers) ? form.volunteers : []} onChange={v => setForm(prev => ({ ...prev, volunteers: v }))} />
            </div>
            {error && <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--eh-danger)' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="eh-btn eh-btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              <button type="button" className="eh-btn" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        </SectionCard>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', columnGap: 18, rowGap: 0, alignItems: 'start' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <SectionCard flush>
                {event.banner
                  ? <AuthImage kind="banner" eventId={id} src={event.banner} alt={event.name} height={260} fit="cover" radius={0} />
                  : <div style={{ height: 96, background: 'linear-gradient(135deg, var(--eh-primary), var(--eh-secondary))' }} />}
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--eh-ink)', margin: 0 }}>{event.name}</h2>
                      <div style={{ fontSize: 12.5, color: 'var(--eh-ink-soft)', marginTop: 4 }}>
                        {[event.ngo_name, event.sector_name, event.activity_name].filter(Boolean).join(' · ') || 'No programme context'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <StatusPill status={event.status} />
                      {event.priority && <Badge tone="muted">{event.priority}</Badge>}
                      {event.category && <Badge tone="secondary">{event.category}</Badge>}
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <InfoGrid min={160}>
                      <InfoField label="Date">{fmtDate(event.date)}</InfoField>
                      <InfoField label="Time">{timeLabel(event.start_time, event.end_time)}</InfoField>
                      <InfoField label="Venue">{event.venue}</InfoField>
                      <InfoField label="Location">{locationLabel}</InfoField>
                    </InfoGrid>
                  </div>
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Event Information">
              <InfoGrid>
                <InfoField label="NGO">{event.ngo_name}</InfoField>
                <InfoField label="Sector">{event.sector_name}</InfoField>
                <InfoField label="Activity">{event.activity_name}</InfoField>
                <InfoField label="Category">{event.category}</InfoField>
                <InfoField label="Priority">{event.priority}</InfoField>
                <InfoField label="Event ID">#{event.id}</InfoField>
                <InfoField label="Created">{event.created_at ? new Date(event.created_at).toLocaleDateString() : '—'}</InfoField>
              </InfoGrid>
            </SectionCard>

            <SectionCard title="Schedule & Location">
              <InfoGrid>
                <InfoField label="Date">{fmtDate(event.date)}</InfoField>
                <InfoField label="Time">{timeLabel(event.start_time, event.end_time)}</InfoField>
                <InfoField label="Venue">{event.venue}</InfoField>
                <InfoField label="District">{event.district}</InfoField>
                <InfoField label="State">{event.state}</InfoField>
                <InfoField label="GPS Location">{event.gps_location}</InfoField>
              </InfoGrid>
            </SectionCard>

            <SectionCard title="Beneficiaries & Budget">
              <InfoGrid min={140}>
                <InfoField label="Expected Beneficiaries">
                  {event.expected_beneficiaries != null && event.expected_beneficiaries !== '' ? Number(event.expected_beneficiaries).toLocaleString() : '—'}
                </InfoField>
                <InfoField label="Budget">{money(event.budget)}</InfoField>
              </InfoGrid>
            </SectionCard>

            <SectionCard title="Organizers">
              <InfoGrid>
                <InfoField label="Organizer">{event.organizer}</InfoField>
                <InfoField label="Event Manager">{event.event_manager}</InfoField>
                <InfoField label="Coordinator">{event.coordinator}</InfoField>
                <InfoField label="CSR Partner">{event.csr_partner}</InfoField>
                <InfoField label="Donor">{event.donor}</InfoField>
                <InfoField label="Funding Source">{event.funding_source}</InfoField>
              </InfoGrid>
            </SectionCard>

            <div style={{ gridColumn: '1 / -1' }}>
              <SectionCard title="Description">
                {event.description
                  ? <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--eh-ink)', whiteSpace: 'pre-wrap' }}>{event.description}</div>
                  : <Empty icon="📝">No description added yet.</Empty>}
                {event.notes && (
                  <div style={{ marginTop: event.description ? 14 : 0, padding: '10px 12px', background: 'var(--eh-tint-2)', borderRadius: 10, fontSize: 12.5, color: 'var(--eh-ink-soft)' }}>
                    <b style={{ color: 'var(--eh-ink)' }}>Notes: </b>{event.notes}
                  </div>
                )}
              </SectionCard>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <SectionCard
                title="Photos & Media"
                sub={media.length ? `${media.length} file${media.length !== 1 ? 's' : ''}` : 'No uploads yet'}
                headRight={media.length > 0 ? (
                  <button className="eh-btn" onClick={() => setEditBanner(bannerMedia || media[0])}>Edit Banner</button>
                ) : (
                  <button className="eh-btn" onClick={() => navigate('/event-head/media-management?event=' + id)}>Manage Media</button>
                )}
              >
                {media.length === 0 ? (
                  <Empty icon="🖼️">No photos or media uploaded for this event.</Empty>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
                    {media.map((m, i) => {
                      const isImg = /image/i.test(m.type || '') || /\.(png|jpe?g|gif|webp|avif)$/i.test(m.url || '')
                      return (
                        <div key={m.id || i}>
                          {isImg
                            ? <AuthImage src={m.url} eventId={id} mediaId={m.id} alt={m.title || m.name || 'media'} height={120} fit="cover" />
                            : <div style={{ height: 120, borderRadius: 12, background: 'var(--eh-tint-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--eh-ink-soft)' }}>{m.media_type || 'File'}</div>}
                          <div style={{ fontSize: 11.5, color: 'var(--eh-ink-soft)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.title || m.name || 'Untitled'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </SectionCard>
            </div>
          </div>
        </>
      )}

      {(() => {
        const vols = Array.isArray(event.volunteers) ? event.volunteers : []
        if (!vols.length) return null
        const teamOrder = ['Volunteer', 'Management']
        const teamLabel = { Volunteer: 'Volunteer Team', Management: 'Management Team' }
        const ngoSort = (a, b) => {
          const m = { BSCT: 0, AFLF: 1, MANN: 2, MAN: 2, OTHERS: 3, OTHER: 3 }
          const ai = m[String(a).toUpperCase()] ?? 100
          const bi = m[String(b).toUpperCase()] ?? 100
          return ai - bi || String(a).localeCompare(String(b))
        }
        return teamOrder.map(team => {
          const items = vols.filter(v => (v.team === 'Management' ? 'Management' : 'Volunteer') === team)
          if (!items.length) return null
          const groups = {}
          for (const v of items) (groups[v.ngo || 'Others'] = groups[v.ngo || 'Others'] || []).push(v.name)
          return (
            <SectionCard key={team} title={teamLabel[team]}>
              {Object.keys(groups).sort(ngoSort).map(ngo => (
                <div key={ngo} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--eh-ink-soft)', marginBottom: 6 }}>{ngo} <span style={{ color: 'var(--eh-ink-faint)' }}>· {groups[ngo].length}</span></div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {groups[ngo].map(name => (
                      <span key={name} className="eh-badge" style={{ background: 'var(--eh-tint-1)', color: 'var(--eh-primary)', fontSize: 12 }}>{name}</span>
                    ))}
                  </div>
                </div>
              ))}
            </SectionCard>
          )
        })
      })()}

      <SectionCard title="Activity Link">
        {event.activity_id ? (
          <button className="eh-btn" onClick={() => navigate('/event-head/activities/' + event.activity_id)}>View Activity: {event.activity_name || '#' + event.activity_id}</button>
        ) : (
          <span style={{ color: 'var(--eh-ink-soft)', fontSize: 13 }}>This event is not yet linked to an activity.</span>
        )}
      </SectionCard>

      {confirmDelete && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,17,40,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          onClick={() => { if (!deleting) setConfirmDelete(false) }}
        >
          <div className="eh-section" style={{ width: 'min(440px, 100%)', marginBottom: 0 }} onClick={e => e.stopPropagation()}>
            <div className="eh-section-head"><div><h3>Delete event?</h3></div></div>
            <div className="eh-section-body">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--eh-ink-soft)', lineHeight: 1.6 }}>
                “{event.name}” and its event details will be permanently removed. This cannot be undone.
              </p>
              {deleteError && <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--eh-danger)' }}>{deleteError}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
                <button className="eh-btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
                <button
                  className="eh-btn eh-btn-primary"
                  style={{ background: 'var(--eh-danger)', border: 'none' }}
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting…' : 'Delete Event'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editBanner && (
        <EditBannerModal
          media={editBanner}
          event={event}
          onClose={() => setEditBanner(null)}
          onSaved={() => { setEditBanner(null); load() }}
        />
      )}
    </>
  )
}
