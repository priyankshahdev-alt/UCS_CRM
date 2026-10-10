import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CATEGORIES, PRIORITIES, BENEFICIARY_CATEGORIES, fetchWorkspaceNgos, fetchSectors, fetchActivities, createEvent, createActivity, createSector, suggestEventSpelling, suggestDayPrograms, observancesOnDate, fetchCalendarObservances, uploadEventBanner, CHECKLIST_ITEMS, CHECKLIST_MATERIALS, createChecklistItem } from '../store'
import { PageHeader } from '../components/ui'
import VoluntaryPicker from '../components/VoluntaryPicker'
import ActivitySelect from '../components/ActivitySelect'
import usePasteImage from '../../../utils/usePasteImage'

export default function CreateEvent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [ngos, setNgos] = useState([])
  const [sectors, setSectors] = useState([])
  const [allActivities, setAllActivities] = useState([])
  const [form, setForm] = useState({
    name:'', category:'', ngo_id: searchParams.get('ngo_id') || '', sector_id: searchParams.get('sector_id') || '', activityName:'',
    date:'', start_time:'', end_time:'', venue:'', priority:'Medium', banner:'',
    description:'', expected_beneficiaries:'', organizer:'', event_manager:'', coordinator:'',
  })
  /* ── Daily Planning Form block ─────────────────────────────────────────────
     These fields are saved together in one JSONB column (event_head_events.
     planning, migration 176): volunteer requirement, beneficiary categories,
     the distribution/service table and the special-arrangements note. Number
     of beneficiaries reuses expected_beneficiaries and Description reuses the
     existing description column, so they live on `form` instead. */
  const EMPTY_DISTRIBUTION_ROWS = 5
  const [planning, setPlanning] = useState({
    volunteers_required: '',
    volunteer_role: '',
    beneficiary_categories: [],
    distribution_items: Array.from({ length: EMPTY_DISTRIBUTION_ROWS }, () => ({ item: '', qty: '', remarks: '' })),
    special_requirements: '',
  })
  const updatePlanning = (patch) => setPlanning(prev => ({ ...prev, ...patch }))
  const toggleBeneficiaryCategory = (cat) => setPlanning(prev => {
    const on = prev.beneficiary_categories.includes(cat)
    return { ...prev, beneficiary_categories: on ? prev.beneficiary_categories.filter(c => c !== cat) : [...prev.beneficiary_categories, cat] }
  })
  const addDistributionRow = () => setPlanning(prev => ({ ...prev, distribution_items: [...prev.distribution_items, { item: '', qty: '', remarks: '' }] }))
  const removeDistributionRow = (index) => setPlanning(prev => ({ ...prev, distribution_items: prev.distribution_items.filter((_, i) => i !== index) }))
  const updateDistributionRow = (index, patch) => setPlanning(prev => ({ ...prev, distribution_items: prev.distribution_items.map((r, i) => (i === index ? { ...r, ...patch } : r)) }))
  /* Month picker that opens the Monthly Planner on that month. The actual day is
     chosen on the planner's grid, which is where the calendar already lives —
     this form only carries the month, so it never claims a day the user has not
     actually picked. Defaults to the month we are already in, or to ?month= when
     the user arrived from the Overview page after choosing a month there. */
  const [month, setMonth] = useState(() => {
    const fromUrl = (searchParams.get('month') || '').trim()
    if (/^\d{4}-\d{2}$/.test(fromUrl)) return fromUrl
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
  })
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const monthYears = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    return [y, y + 1]
  }, [])
  const openMonthlyPlanner = () => {
    if (!month) return
    const params = new URLSearchParams({ month })
    if (form.ngo_id) params.set('ngo_id', form.ngo_id)
    navigate('/event-head/monthly-planner?' + params.toString())
  }
  const [saving, setSaving] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [volunteers, setVolunteers] = useState([])
  const [checklist, setChecklist] = useState([
    ...CHECKLIST_ITEMS.map(label => ({ key: `setup:${label}`, group: 'Setup', label, status: false, notes: '' })),
    ...CHECKLIST_MATERIALS.map(label => ({ key: `material:${label}`, group: 'Material', label, status: false, notes: '' })),
  ])
  const [bannerUploading, setBannerUploading] = useState(false)
  const [bannerError, setBannerError] = useState('')
  const [bannerLocalUrl, setBannerLocalUrl] = useState('')
  const [bannerLoadError, setBannerLoadError] = useState(false)
  const [bannerMeta, setBannerMeta] = useState(null)
  const [bannerDropActive, setBannerDropActive] = useState(false)
  const [bannerType, setBannerType] = useState('banner')
  const [addingSector, setAddingSector] = useState(false)
  const [newSectorName, setNewSectorName] = useState('')
  const [sectorSaving, setSectorSaving] = useState(false)
  const [sectorNote, setSectorNote] = useState('')
  const [sectorNoteError, setSectorNoteError] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState({})
  const [aiChecking, setAiChecking] = useState(false)
  const [aiUnavailable, setAiUnavailable] = useState(false)
  const [aiDismissed, setAiDismissed] = useState({})
  const [aiRan, setAiRan] = useState(false)

  /* 4-step wizard. Only the active step's fields are mounted; every value still
     lives in `form` / `planning` / `checklist`, so switching steps loses nothing. */
  const [step, setStep] = useState(1)
  const STEP_LABELS = ['Program', 'Volunteers', 'Distribution', 'Checklist']
  const STEP_COUNT = STEP_LABELS.length
  const FIELD_STEP = { name: 1, ngo_id: 1, sector_id: 1, date: 1 }
  const cardRef = useRef(null)

  /* ── Festival / day programme suggestions ──────────────────────────────────
     A separate concern from the spelling hints above and deliberately NOT
     auto-fired: it is one AI call that can take 10-60s, so it runs on an explicit
     click once the Event Date and a Sector are both known. Both are required —
     the date supplies the occasion and the sector supplies the frame, and
     prompting without either produced generic ideas. */
  const [festIdeas, setFestIdeas] = useState([])
  const [festObservances, setFestObservances] = useState([])
  const [festLoading, setFestLoading] = useState(false)
  const [festAi, setFestAi] = useState(null)   // { available, provider, model, reason, truncated, requested }
  const [festDismissed, setFestDismissed] = useState(false)
  const bannerFileRef = useRef(null)
  const localUrlRef = useRef('')
  const onBannerPaste = usePasteImage(({ file }) => { if (file) uploadBanner(file) })

  // Server-side multer limit is 50MB. Checked here too so an oversized file is
  // rejected immediately with a clear message instead of failing mid-upload.
  const BANNER_MAX_BYTES = 50 * 1024 * 1024
  const BANNER_WARN_BYTES = 5 * 1024 * 1024
  const formatBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

  // Drop the local preview object URL, if one is held.
  const releaseLocalUrl = () => {
    if (localUrlRef.current) { URL.revokeObjectURL(localUrlRef.current); localUrlRef.current = '' }
  }

  const clearBanner = () => {
    releaseLocalUrl()
    setBannerLocalUrl('')
    setBannerMeta(null)
    setBannerLoadError(false)
    setBannerError('')
    setForm(prev => ({ ...prev, banner: '' }))
    if (bannerFileRef.current) bannerFileRef.current.value = ''
  }

  const uploadBanner = (file) => {
    if (!file || bannerUploading) return

    if (!String(file.type || '').startsWith('image/')) {
      setBannerError(`"${file.name}" is not an image. Please choose a JPG, PNG or WebP file.`)
      if (bannerFileRef.current) bannerFileRef.current.value = ''
      return
    }
    if (file.size > BANNER_MAX_BYTES) {
      setBannerError(`That image is ${formatBytes(file.size)} — the limit is ${formatBytes(BANNER_MAX_BYTES)}. Please compress it or pick a smaller one.`)
      if (bannerFileRef.current) bannerFileRef.current.value = ''
      return
    }

    setBannerUploading(true)
    setBannerError('')
    setBannerLoadError(false)
    setBannerMeta({ name: file.name, size: file.size, slow: file.size > BANNER_WARN_BYTES })

    // Show the chosen image straight away from a local object URL, so the user
    // sees their picture while the upload is still running instead of staring at
    // an empty box. Swapped for the stored URL once the upload succeeds.
    releaseLocalUrl()
    const localUrl = URL.createObjectURL(file)
    localUrlRef.current = localUrl
    setBannerLocalUrl(localUrl)

    const fd = new FormData()
    fd.append('file', file, file.name)
    uploadEventBanner(fd)
      .then(res => {
        const url = (res && res.url) || ''
        if (!url) { setBannerError('Upload finished but the server sent no image URL. Please try again.'); return }
        releaseLocalUrl()
        setBannerLocalUrl('')
        setForm(prev => ({ ...prev, banner: url }))
        if (bannerFileRef.current) bannerFileRef.current.value = ''
      })
      .catch(err => {
        releaseLocalUrl()
        setBannerLocalUrl('')
        setBannerError(err.message || 'Banner upload failed')
        if (bannerFileRef.current) bannerFileRef.current.value = ''
      })
      .finally(() => setBannerUploading(false))
  }

  // Release the object URL if the form is closed mid-upload.
  useEffect(() => () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current)
  }, [])

  useEffect(() => {
    Promise.all([
      fetchWorkspaceNgos().catch(() => []),
      fetchSectors().catch(() => []),
      fetchActivities().catch(() => []),
    ]).then(([n, s, a]) => {
      setNgos(n || [])
      setSectors(s || [])
      setAllActivities(a || [])
    })
  }, [])

  const ngoId = form.ngo_id ? String(form.ngo_id) : ''
  const sectorId = form.sector_id ? String(form.sector_id) : ''

  // Fields that support AI spelling suggestions (free-text only). Picked values
  // (NGO, sector, activity, dates, priority) can never be misspelled, so they are
  // left out to avoid spending a GROQ call on them.
  const SPELL_FIELDS = ['name', 'activityName', 'category', 'venue', 'organizer', 'event_manager', 'coordinator']

  // An activity picked from the dropdown is an existing, correctly spelled name.
  // Running the spell-checker over it is a wasted call, and worse, accepting a
  // "correction" would turn a valid name into a brand new duplicate activity —
  // so an activity is only checked while it is a name that does not exist yet.
  const isExistingActivity = (name) => {
    const t = String(name || '').trim().toLowerCase()
    if (!t) return false
    return allActivities.some(a => String(a.name || '').trim().toLowerCase() === t)
  }

  const applySuggestion = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }))
    setAiDismissed(prev => ({ ...prev, [key]: true }))
  }

  const applyAllSuggestions = () => {
    const next = { ...form }
    const dismissed = { ...aiDismissed }
    for (const [key, s] of Object.entries(aiSuggestions)) {
      const corrected = (s && s.corrected) || s
      next[key] = corrected
      dismissed[key] = true
    }
    setForm(next)
    setAiDismissed(dismissed)
  }

  // Debounced auto spell-check: after ~900ms of no typing, ask GROQ for
  // corrections and surface them as suggestions. Never blocks event creation.
  useEffect(() => {
    const fields = SPELL_FIELDS
      .map(key => ({ key, value: String(form[key] || '').trim() }))
      .filter(f => f.value)
      .filter(f => (f.key === 'activityName' ? !isExistingActivity(f.value) : true))

    if (!fields.length) { setAiSuggestions({}); setAiUnavailable(false); return }
    const timer = setTimeout(() => {
      let cancelled = false
      setAiChecking(true)
      suggestEventSpelling(fields)
        .then(data => {
          if (cancelled) return
          const sugg = (data && data.suggestions) || {}
          setAiSuggestions(sugg)
          setAiUnavailable(false)
          setAiRan(true)
        })
        .catch(() => {
          if (!cancelled) setAiUnavailable(true)
        })
        .finally(() => {
          if (!cancelled) setAiChecking(false)
        })
      return () => { cancelled = true }
    }, 900)
    return () => clearTimeout(timer)
  }, [allActivities, form.name, form.activityName, form.category, form.venue, form.organizer, form.event_manager, form.coordinator])

  const relevantSectors = useMemo(() => {
    const ids = new Set()
    for (const a of allActivities) {
      if (a.ngo_id == null || String(a.ngo_id) === ngoId) ids.add(String(a.sector_id))
    }
    let list = sectors.filter(s => ids.has(String(s.id)))
    if (!list.some(s => String(s.id) === sectorId) && form.sector_id) {
      const cur = sectors.find(s => String(s.id) === sectorId)
      if (cur) list = [cur, ...list]
    }
    return list
  }, [sectors, allActivities, ngoId, sectorId, form.sector_id])

  /* Activities for the chosen NGO+sector. Sending only these (rather than every
     activity the org has) keeps the model inside the sector the user actually
     picked, and keeps the request small enough for the provider's token budget. */
  const sectorActivities = useMemo(() => {
    if (!ngoId || !sectorId) return []
    return allActivities
      .filter(a => String(a.sector_id) === sectorId)
      .filter(a => a.ngo_id == null || String(a.ngo_id) === ngoId)
      .map(a => ({ id: a.id ?? a.activity_id, name: a.name }))
      .filter(a => a.id !== undefined && a.id !== null && a.name)
  }, [allActivities, ngoId, sectorId])

  const canSuggestForDate = Boolean(form.date && form.sector_id)

  /* Which festival / important day the chosen date actually carries. The
     bundled reference calendar answers instantly — no API call, no AI, nothing
     to wait for — and stays as the offline fallback. The server range (curated
     + operator holidays + fixed international days + Calendarific) then
     replaces it, so this hint shows exactly what the Calendar page shows for
     that date. Shows EVERY observance on that date, because one date can carry
     three (e.g. Akshaya Tritiya + Ambedkar Jayanti + World Parkinson's Day). */
  const bundledDayObservances = useMemo(() => (form.date ? observancesOnDate(form.date) : []), [form.date])
  const [dayObservances, setDayObservances] = useState(bundledDayObservances)
  useEffect(() => {
    setDayObservances(bundledDayObservances)
    const date = form.date
    if (!date) return undefined
    let cancelled = false
    const nextDay = (() => {
      const d = new Date(`${date}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + 1)
      return d.toISOString().slice(0, 10)
    })()
    fetchCalendarObservances({ start: date, end: nextDay, scope: 'all' })
      .then(res => {
        if (cancelled) return
        const rows = (Array.isArray(res?.observances) ? res.observances : []).filter(o => o?.date === date)
        if (rows.length) setDayObservances(rows)
      })
      .catch(() => {})   // fetchCalendarObservances already degrades to the bundled rows
    return () => { cancelled = true }
  }, [bundledDayObservances, form.date])

  const runFestivalSuggestions = () => {
    if (!canSuggestForDate || festLoading) return
    setFestLoading(true)
    setFestDismissed(false)
    const sectorName = sectors.find(s => String(s.id) === String(form.sector_id))?.name || ''
    const ngoName = ngos.find(n => String(n.id) === ngoId)?.name || ''
    suggestDayPrograms({
      date: form.date,
      scope: 'all',
      ngoName,
      sectorId: form.sector_id,
      sectorName,
      sectors: sectorName ? [sectorName] : [],
      activityOptions: sectorActivities,
      existingTitles: [],
    })
      .then(data => {
        setFestIdeas(Array.isArray(data?.suggestions) ? data.suggestions : [])
        setFestObservances(Array.isArray(data?.observances) ? data.observances : [])
        setFestAi(data?.ai || { available: false, reason: 'No response from the server.' })
      })
      .catch(err => {
        setFestIdeas([])
        setFestObservances([])
        setFestAi({ available: false, reason: 'Could not reach the server. Try again in a moment.' })
        console.warn('festival suggestions failed:', err?.message || err)
      })
      .finally(() => setFestLoading(false))
  }

  /* Fill the form from a suggestion. Nothing is saved — the user still presses
     Create Event, so every field stays reviewable and editable.

     Only fields that genuinely exist on this form are written. The suggestion
     also carries objective/rationale/audience/duration/materials, which this form
     has nowhere to store; they are shown in the card for the user to read and
     copy, rather than being crammed into an unrelated field. */
  const applyFestivalSuggestion = (idea) => {
    setForm(prev => {
      const next = { ...prev }
      if (idea.title) next.name = String(idea.title).slice(0, 120)
      // A validated activity id is already one of the org's real activities, so
      // writing its exact name is safe: pickActivity will not create a duplicate.
      if (idea.activityName) next.activityName = String(idea.activityName).slice(0, 120)
      if (idea.format) next.category = String(idea.format).slice(0, 60)
      if (idea.priority) {
        // The form offers a fixed priority list; only adopt a value it has.
        const match = PRIORITIES.find(p => p.toLowerCase() === String(idea.priority).toLowerCase())
        if (match) next.priority = match
      }
      return next
    })
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    // Clear the red outline as soon as the user starts fixing that field.
    if (errorField && name === errorField) clearError()
    setForm(prev => {
      const next = { ...prev, [name]: value }
      if (name === 'ngo_id') { next.sector_id = ''; next.activityName = '' }
      if (name === 'sector_id') next.activityName = ''
      return next
    })
  }

  // Picking an existing activity fills in its sector too, because the server
  // rejects an event whose activity belongs to a different sector. A name that
  // does not exist yet is just set as typed — resolveActivity() creates it on
  // save, and only then does it need a sector.
  const pickActivity = (name, activity) => {
    if (errorField === 'activityName') clearError()
    setForm(prev => {
      const next = { ...prev, activityName: name }
      if (activity && activity.sector_id != null) next.sector_id = String(activity.sector_id)
      return next
    })
  }

  // Resolve the activity name: use an existing one for this NGO+sector,
  // otherwise create it on the fly. Returns the activity id, or null.
  // A newly created activity is added to allActivities straight away so it shows
  // in the dropdown without needing a page reload; on the next visit it is
  // loaded from the database like any other.
  const resolveActivity = async () => {
    const name = String(form.activityName || '').trim()
    if (!name) return null
    const match = allActivities.find(a =>
      String(a.sector_id) === String(form.sector_id) &&
      (a.ngo_id == null || String(a.ngo_id) === String(form.ngo_id)) &&
      String(a.name || '').trim().toLowerCase() === name.toLowerCase()
    )
    if (match) return match.id
    try {
      const created = await createActivity({ ngo_id: form.ngo_id, sector_id: Number(form.sector_id), name, status: 'Active' })
      if (created) {
        setAllActivities(prev => (prev.some(a => String(a.id) === String(created.id)) ? prev : [created, ...prev]))
        return created.id
      }
      return null
    } catch (err) {
      // Duplicate (409) — try to find it again, else surface the error.
      const found = allActivities.find(a =>
        String(a.sector_id) === String(form.sector_id) &&
        String(a.name || '').trim().toLowerCase() === name.toLowerCase()
      )
      return found ? found.id : null
    }
  }

  const saveNewSector = async () => {
    const name = String(newSectorName || '').trim()
    if (!name) { setSectorNote('Enter a sector name first'); setSectorNoteError(true); return }
    setSectorSaving(true)
    setSectorNote('')
    setSectorNoteError(false)
    try {
      const saved = await createSector({ name })
      const id = saved && (saved.id != null ? saved.id : saved.sector_id != null ? saved.sector_id : null)
      if (id == null) { setSectorNote('Could not create the sector'); setSectorNoteError(true); return }
      setSectors(prev => {
        const exists = prev.some(s => String(s.id != null ? s.id : s.sector_id) === String(id))
        return exists ? prev : [{ id, name: saved.name || name }, ...prev]
      })
      setForm(prev => ({ ...prev, sector_id: String(id) }))
      setAddingSector(false)
      setNewSectorName('')
      setSectorNote(saved && saved.existing ? `"${saved.name}" already exists — selected it.` : `Sector "${saved.name || name}" created and selected.`)
      setSectorNoteError(false)
    } catch (err) {
      setSectorNote(err.message || 'Failed to create sector')
      setSectorNoteError(true)
    } finally { setSectorSaving(false) }
  }

  // Field anchors, so a failed save can point at the exact input and bring it
  // into view. The form is long enough that a notice alone is easy to miss when
  // you are already down at the submit buttons.
  const fieldRefs = useRef({})
  const registerField = (key) => (el) => { if (el) fieldRefs.current[key] = el }

  useEffect(() => {
    if (!error || !errorField) return
    // The field may live on another step; move there first so it mounts, then
    // this effect runs again and can scroll/focus it.
    const targetStep = FIELD_STEP[errorField]
    if (targetStep && step !== targetStep) { setStep(targetStep); return }
    const el = fieldRefs.current[errorField]
    if (!el) return
    const t = setTimeout(() => {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        if (typeof el.focus === 'function') el.focus({ preventScroll: true })
      } catch { /* older browsers ignore smooth scrolling */ }
    }, 60)
    return () => clearTimeout(t)
  }, [error, errorField, step])

  // The notice is a nudge, not a blocker: it clears itself after 4 seconds so it
  // never sits on top of the form. Pressing the button again re-reports it.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => { setError(''); setErrorField('') }, 4000)
    return () => clearTimeout(t)
  }, [error])

  const fail = (message, field = '') => { setError(message); setErrorField(field) }
  const clearError = () => { setError(''); setErrorField('') }

  // Red outline on the input that failed, plus the reason right underneath it.
  const fieldStyle = (key) => (errorField === key
    ? { borderColor: 'var(--eh-danger,#e53e5b)', boxShadow: '0 0 0 3px var(--eh-danger-soft,#fdecef)' }
    : undefined)
  const fieldError = (key) => (errorField === key
    ? <div style={{ marginTop: 5, fontSize: 12, fontWeight: 600, color: 'var(--eh-danger,#e53e5b)' }}>{error}</div>
    : null)

  // Save path shared by the two actions.
  //   draft = false → "Create Event": every required field present, then back to
  //                  the Events list exactly as before.
  //   draft = true  → "Save Draft": only the name and NGO are required, the row is
  //                  stored with status 'Draft' and we open the Event Detail screen
  //                  so the rest can be filled in later.
  // status is sent only for drafts, so a normal create keeps the server default.
  const persist = async (draft) => {
    clearError()
    setSaving(true)
    if (draft) setSavingDraft(true)
    try {
      if (!form.name.trim()) { fail('Please enter an Event Name', 'name'); return }
      if (!form.ngo_id) { fail('Please choose an NGO', 'ngo_id'); return }
      if (!draft) {
        if (!form.sector_id) { fail('Please choose a Sector', 'sector_id'); return }
        if (!form.date) { fail('Please choose an Event Date in Event Details below, or pick the day from Monthly Planner', 'date'); return }
      }
      const typedActivity = String(form.activityName || '').trim()
      // The activity can only be resolved once a sector is picked, so a draft
      // saved without one keeps the typed text in activity_name instead.
      const activity_id = (typedActivity && form.sector_id) ? await resolveActivity() : null
      if (typedActivity && form.sector_id && !activity_id) { fail('Could not resolve the Activity. Please pick an existing sector and try again.', 'sector_id'); return }
      const distributionItems = planning.distribution_items
        .map(r => ({ item: String(r.item || '').trim(), qty: String(r.qty || '').trim(), remarks: String(r.remarks || '').trim() }))
        .filter(r => r.item || r.qty || r.remarks)
      const planningPayload = {
        volunteers_required: planning.volunteers_required !== '' ? Number(planning.volunteers_required) : null,
        volunteer_role: planning.volunteer_role || null,
        beneficiary_categories: planning.beneficiary_categories,
        distribution_items: distributionItems,
        special_requirements: planning.special_requirements || null,
      }
      const payload = {
        name: form.name,
        category: form.category || null,
        ngo_id: form.ngo_id,
        sector_id: form.sector_id ? Number(form.sector_id) : null,
        activity_id: activity_id ? Number(activity_id) : null,
        activity_name: activity_id ? null : (typedActivity || null),
        date: form.date || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        venue: form.venue || null,
        priority: form.priority || 'Medium',
        banner: form.banner || null,
        description: form.description || null,
        expected_beneficiaries: form.expected_beneficiaries !== '' ? Number(form.expected_beneficiaries) : null,
        organizer: form.organizer || null,
        event_manager: form.event_manager || null,
        coordinator: form.coordinator || null,
        volunteers: volunteers && volunteers.length ? volunteers : null,
        planning: planningPayload,
      }
      if (draft) payload.status = 'Draft'
      const created = await createEvent(payload)
      if (created && created.id != null) {
        await Promise.allSettled(checklist.map(item => createChecklistItem(created.id, { label: item.label, status: !!item.status, notes: item.notes || '' }).catch(e => console.error('Seed checklist item failed:', e))))
      }
      if (draft) {
        if (created && created.id != null) { navigate('/event-head/events/' + created.id); return }
        navigate('/event-head/events?created=1')
        return
      }
      const params = new URLSearchParams({ ngo_id: form.ngo_id, created: 1 })
      if (form.sector_id) params.set('sector_id', form.sector_id)
      navigate('/event-head/events?' + params.toString())
    } catch (err) { fail(err.message || (draft ? 'Failed to save draft' : 'Failed to create event')); console.error(draft ? 'Save draft error:' : 'Create event error:', err) }
    finally { setSaving(false); setSavingDraft(false) }
  }

  /* ── Wizard navigation ──────────────────────────────────────────────────────
     Step 1 is the only step with required fields, so "Next"/forward clicks are
     gated on it; Steps 2–4 gate nothing. Enter (implicit form submit) advances a
     step instead of skipping straight to Create Event. */
  const scrollToCard = () => {
    const el = cardRef.current
    try {
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      else window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch { window.scrollTo(0, 0) }
  }
  const goToStep = (n) => {
    setStep(Math.max(1, Math.min(STEP_COUNT, n)))
    clearError()
    scrollToCard()
  }
  const step1Valid = () => Boolean(form.name.trim() && form.ngo_id && form.sector_id && form.date)
  const validateStep1 = () => {
    if (!form.name.trim()) { fail('Please enter an Event Name', 'name'); return false }
    if (!form.ngo_id) { fail('Please choose an NGO', 'ngo_id'); return false }
    if (!form.sector_id) { fail('Please choose a Sector', 'sector_id'); return false }
    if (!form.date) { fail('Please choose an Event Date, or pick the day from Monthly Planner', 'date'); return false }
    return true
  }
  const next = () => {
    if (step === 1 && !validateStep1()) return
    if (step >= STEP_COUNT) { persist(false); return }
    goToStep(step + 1)
  }
  const prev = () => goToStep(step - 1)
  const onStepperClick = (n) => {
    if (n === step) return
    if (n > step && !step1Valid()) { validateStep1(); return }
    goToStep(n)
  }

  const handleSubmit = (e) => { e.preventDefault(); next() }

  const section = (t) => <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--eh-primary)', margin: '20px 0 12px' }}>{t}</div>

  // Shared styles for the Daily Planning Form's Distribution / Service table.
  const planTh = (width) => ({ padding: '8px 10px', fontWeight: 700, fontSize: 12, color: 'var(--eh-ink-soft,#6a6f8f)', borderBottom: '1px solid var(--eh-line,#e8e6f2)', ...(width ? { width } : {}) })
  const planTd = { padding: '6px 8px', borderBottom: '1px solid var(--eh-line,#e8e6f2)', verticalAlign: 'middle', fontSize: 13 }
  const planCellInput = { width: '100%', padding: '6px 9px', fontSize: 12.5, border: '1px solid var(--eh-line,#e8e6f2)', borderRadius: 8, fontFamily: 'inherit' }
  const taStyle = { resize: 'vertical', minHeight: 68 }

  // Inline AI suggestion note shown just under a field when GROQ suggests a fix.
  const inlineSuggestion = (key) => {
    const sug = aiSuggestions[key]
    if (!sug || aiDismissed[key]) return null
    const corr = (sug && sug.corrected) || sug
    const reason = (sug && sug.reason) || 'looks like it may be spelled differently'
    return (
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#166534', flexWrap: 'wrap' }}>
        <span style={{ color: '#b91c1c' }}>⚠</span>
        <span>Looks like <b>{corr}</b>? <em style={{ color: '#6b7280', fontStyle: 'normal' }}>({reason})</em></span>
        <button type="button" onClick={() => applySuggestion(key, corr)} style={{ border: 'none', background: '#bbf7d0', color: '#166534', borderRadius: 999, padding: '1px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Apply</button>
        <button type="button" onClick={() => setAiDismissed(prev => ({ ...prev, [key]: true }))} style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }} title="Dismiss">✕</button>
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Daily Event Planning Form"
        subtitle="Plan the programme, volunteers, beneficiaries and distribution, then click Create Event"
        actions={<button className="eh-btn" onClick={() => navigate('/event-head/events')}>Cancel</button>}
      />

      {/* Fixed so it stays on screen no matter how far down the long form the
          user has scrolled — it used to sit above the fold, so pressing Create
          Event appeared to do nothing. Sits outside <form> and .eh-section so no
          ancestor overflow can clip it. */}
      {error && (
        <div role="alert" style={{
          position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)',
          zIndex: 2600, display: 'flex', alignItems: 'center', gap: 10,
          maxWidth: 'min(560px, calc(100vw - 32px))', padding: '12px 14px',
          borderRadius: 14, background: 'var(--eh-surface-2,#fff)',
          border: '1px solid var(--eh-danger,#e53e5b)',
          boxShadow: '0 14px 40px rgba(15,17,40,.22)',
        }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--eh-danger,#e53e5b)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--eh-ink,#0f1128)', minWidth: 0 }}>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss" style={{
            marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--eh-ink-soft,#6a6f8f)', fontSize: 14, lineHeight: 1, padding: 4,
          }}>✕</button>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>

        {/* ═══ AI SPELL SUGGESTIONS PANEL ═══ */}
        {(Object.keys(aiSuggestions).length > 0 || aiChecking || aiUnavailable) && (
          <div style={{ margin: '14px 0', borderRadius: 12, border: '1px solid #bbf7d0', background: '#f0fdf4', padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>
                {aiChecking ? '✨ Checking spellings…' : '✨ AI Spell Suggestions'}
              </div>
              {Object.keys(aiSuggestions).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="eh-btn eh-btn-primary" style={{ fontSize: 12, padding: '5px 12px' }} onClick={applyAllSuggestions}>Accept All</button>
                  <button type="button" className="eh-btn" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => setAiSuggestions({})}>Dismiss</button>
                </div>
              )}
            </div>
            {aiUnavailable && !aiChecking && (
              <div style={{ fontSize: 12, color: '#b45309' }}>AI spell check is unavailable right now — you can still create the event.</div>
            )}
            {Object.keys(aiSuggestions).length === 0 && !aiUnavailable && aiChecking && (
              <div style={{ fontSize: 12, color: '#6b7280' }}>Reviewing your spelling as you type…</div>
            )}
            {Object.keys(aiSuggestions).length === 0 && !aiUnavailable && !aiChecking && aiRan && (
              <div style={{ fontSize: 12, color: '#166534' }}>No spelling issues detected 👌</div>
            )}
            {Object.keys(aiSuggestions).reduce((acc, k) => {
              const orig = String(form[k] || '')
              const sug = aiSuggestions[k]
              const corr = (sug && sug.corrected) || sug
              const reason = (sug && sug.reason) || 'looks like it may be spelled differently'
              if (aiDismissed[k]) return acc
              acc.push(
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #d1fae5', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, color: '#374151', minWidth: 0 }}>
                    <span style={{ fontWeight: 700, textTransform: 'capitalize', color: '#166534' }}>{k.replace(/_/g, ' ')}:</span>{' '}
                    <span style={{ textDecoration: 'line-through', color: '#9ca3af' }}>{orig}</span>
                    {' → '}
                    <span style={{ fontWeight: 600, color: '#065f46' }}>{corr}</span>
                    <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{reason}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="eh-btn eh-btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => applySuggestion(k, corr)}>Apply</button>
                    <button type="button" className="eh-btn" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => setAiDismissed(prev => ({ ...prev, [k]: true }))}>✕</button>
                  </div>
                </div>
              )
              return acc
            }, [])}
          </div>
        )}

        <div className="eh-section" ref={cardRef}>
          <div className="eh-section-head">
            <div>
              <h3>Daily Event Planning Form</h3>
            </div>
          </div>

          <div className="eh-wizard-head">
            <div className="eh-wizard-steps" role="tablist" aria-label="Event planning steps">
              {STEP_LABELS.map((label, i) => {
                const n = i + 1
                const state = step === n ? 'active' : step > n ? 'done' : 'todo'
                return (
                  <button
                    key={label}
                    type="button"
                    role="tab"
                    aria-selected={step === n}
                    className={`eh-wizard-step ${state}`}
                    onClick={() => onStepperClick(n)}
                  >
                    <span className="eh-wizard-dot">{step > n ? '✓' : n}</span>
                    <span className="eh-wizard-label">{label}</span>
                  </button>
                )
              })}
            </div>
            <div className="eh-wizard-mobile">Step {step} of {STEP_COUNT} · {STEP_LABELS[step - 1]}</div>
            <div className="eh-wizard-bar"><span style={{ width: `${(step / STEP_COUNT) * 100}%` }} /></div>
          </div>

          <div className="eh-section-body">
            {step === 1 && (
              <>
            {/* Field order follows the order the form is actually filled in: pick the
                NGO, then the month, then jump to the Monthly Planner to click the real
                day on the grid. The exact date input lives in Event Details below, for
                the quick case where the day is already known — the festival chips and
                the suggestion panel read the same form.date either way. */}
            <div className="form-row">
              <div className="field">
                <label>Event Name *</label>
                <input name="name" value={form.name} onChange={handleChange} ref={registerField('name')} style={fieldStyle('name')} placeholder="e.g. Diwali distribution — Sector 8" />
                {fieldError('name')}
              </div>
            </div>
            <div className="form-row">
              <div className="field"><label>NGO *</label>
                <select name="ngo_id" value={form.ngo_id} onChange={handleChange} ref={registerField('ngo_id')} style={fieldStyle('ngo_id')}>
                  <option value="">Select NGO</option>
                  {ngos.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
                {fieldError('ngo_id')}
              </div>
              <div className="field"><label>Month</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select name="month" value={month} onChange={e => setMonth(e.target.value)} style={{ flex: 1 }}>
                    {monthYears.map(y => MONTH_NAMES.map((m, i) => {
                      const val = `${y}-${String(i + 1).padStart(2, '0')}`
                      return <option key={val} value={val}>{m} {y}</option>
                    }))}
                  </select>
                  <button type="button" className="eh-btn" onClick={openMonthlyPlanner} title="Open the Monthly Planner on this month and pick the day on the calendar" style={{ whiteSpace: 'nowrap', padding: '7px 12px' }}>Monthly Planner</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--eh-muted,#64748b)', marginTop: 5 }}>Pick the exact day on the Monthly Planner grid.</div>
              </div>
            </div>
            <div className="form-row">
              <div className="field"><label>Sector *</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select name="sector_id" value={form.sector_id} onChange={handleChange} disabled={!ngoId} ref={registerField('sector_id')} style={{ flex: 1, ...fieldStyle('sector_id') }}>
                    <option value="">{ngoId ? 'Select sector' : 'Select NGO first'}</option>
                    {relevantSectors.map(s => <option key={s.id ?? s.sector_id} value={s.id ?? s.sector_id}>{s.name}</option>)}
                  </select>
                  <button type="button" className="eh-btn" disabled={!ngoId} title="Add a new sector" onClick={() => { setAddingSector(v => !v); setSectorNote('') }} style={{ whiteSpace: 'nowrap', padding: '7px 12px' }}>+ Add</button>
                </div>
                {addingSector && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input value={newSectorName} onChange={e => setNewSectorName(e.target.value)} placeholder="New sector name…" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveNewSector() } }} style={{ flex: '1 1 200px', padding: '7px 10px', fontSize: 13, border: '1px solid var(--eh-line,#e8e6f2)', borderRadius: 10 }} />
                    <button type="button" className="eh-btn eh-btn-primary" disabled={sectorSaving} onClick={saveNewSector} style={{ padding: '7px 12px' }}>{sectorSaving ? 'Saving…' : 'Save'}</button>
                    <button type="button" className="eh-btn" disabled={sectorSaving} onClick={() => { setAddingSector(false); setNewSectorName(''); setSectorNote('') }} style={{ padding: '7px 12px' }}>Cancel</button>
              </div>
                )}
                {sectorNote && <div style={{ marginTop: 6, fontSize: 12, color: sectorNoteError ? '#b91c1c' : '#16a34a' }}>{sectorNote}</div>}
                {fieldError('sector_id')}
              </div>
              <div className="field"><label>This day is</label>
                {!form.date ? (
                  <div style={{ fontSize: 12, color: 'var(--eh-muted,#64748b)', paddingTop: 6 }}>Choose an event date above to see which day it falls on.</div>
                ) : dayObservances.length ? (
                  /* Every observance on the date, not just the first — one day can carry
                     three. Colours match the calendar chips so the two views agree. */
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                    {dayObservances.map(o => (
                      <span
                        key={o.name}
                        title={`${o.name} — ${o.scope === 'india' ? 'India' : 'Worldwide'}${o.precision === 'lunar' ? ' · lunar date, confirm against the gazette' : ''}`}
                        style={{
                          fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 7,
                          borderLeft: `2.5px solid ${o.kind === 'religious' ? '#8b5cf6' : o.kind === 'festival' ? '#16a34a' : o.kind === 'national' ? '#f59e0b' : '#0ea5e9'}`,
                          background: `color-mix(in srgb, ${o.kind === 'religious' ? '#8b5cf6' : o.kind === 'festival' ? '#16a34a' : o.kind === 'national' ? '#f59e0b' : '#0ea5e9'} 12%, #fff)`,
                          color: 'var(--eh-ink,#111827)',
                        }}
                      >
                        {o.scope === 'india' ? '🇮🇳' : '🌍'} {o.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--eh-muted,#64748b)', paddingTop: 6 }}>
                    No festival or important day on {form.date} — a normal working day.
                  </div>
                )}
              </div>
            </div>

            {/* AI programme suggestions. Sits between Sector and Activity on purpose:
                the date and the sector are both known here, and the Activity field
                right below it is exactly what these ideas help the user choose.
                Festival dates themselves are never the model's job — the day above
                already shows them, straight from the reference calendar. */}
            <div style={{ margin: '4px 0 14px' }}>
              {!canSuggestForDate ? (
                <div style={{ fontSize: 12, color: 'var(--eh-muted,#64748b)' }}>
                  Set an <strong>Event Date</strong> and a <strong>Sector</strong> to get programme suggestions for that day.
                </div>
              ) : !festIdeas.length && !festLoading && !festAi ? (
                <button type="button" className="btn" onClick={runFestivalSuggestions}
                  style={{ fontSize: 12, padding: '6px 12px' }}>
                  ✦ Suggested programmes for {form.date}
                </button>
              ) : null}

              {festLoading && (
                <div style={{ fontSize: 12, color: 'var(--eh-muted,#64748b)', padding: '8px 0' }}>
                  Thinking about {form.date}… this can take up to a minute.
                </div>
              )}

              {festAi && !festLoading && festAi.available === false && (
                <div style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px', margin: '6px 0' }}>
                  {festAi.reason}
                  <button type="button" className="btn" onClick={runFestivalSuggestions}
                    style={{ marginLeft: 10, fontSize: 11, padding: '2px 8px' }}>Try again</button>
                </div>
              )}

              {/* The provider answered but every idea was rejected by validation
                  (e.g. all of them duplicated the titles already scheduled). Saying
                  so beats showing an empty box with no explanation. */}
              {festAi && !festLoading && festAi.available !== false && festIdeas.length === 0 && (
                <div style={{ fontSize: 12, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px', margin: '6px 0' }}>
                  The provider returned no usable suggestion for this date. Try “New set”.
                  <button type="button" className="btn" onClick={runFestivalSuggestions}
                    style={{ marginLeft: 10, fontSize: 11, padding: '2px 8px' }}>New set</button>
                </div>
              )}

              {festIdeas.length > 0 && (                <div style={{ border: '1px solid var(--eh-line,#e2e8f0)', borderRadius: 8, padding: 10, background: 'var(--eh-surface,#f8fafc)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--eh-ink,#0f1128)' }}>
                      ✦ Suggested programmes
                      <div style={{ fontWeight: 600, fontSize: 11.5, marginTop: 3 }}>
                        {festObservances.length
                          ? `For ${form.date} · ${festObservances.map(o => o.name).join(', ')}`
                          : `For ${form.date} · no festival on this date`}
                      </div>
                      <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--eh-muted,#64748b)', marginTop: 2 }}>
                        {festObservances.length
                          ? 'Built around the occasion above.'
                          : 'No registered occasion — these are general programme ideas for an ordinary day.'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn" onClick={runFestivalSuggestions}
                        style={{ fontSize: 11, padding: '2px 8px' }} disabled={festLoading}>↻ New set</button>
                      <button type="button" className="btn" onClick={() => setFestDismissed(v => !v)}
                        style={{ fontSize: 11, padding: '2px 8px' }}>{festDismissed ? 'Show' : 'Hide'}</button>
                    </div>
                  </div>

                  {festAi?.truncated && (
                    <div style={{ fontSize: 11, color: '#92400e', marginBottom: 8 }}>
                      Showing {festIdeas.length} of {festAi.requested} — the provider reached its response limit, so it was cut before the rest. Use “New set” for different ideas.
                    </div>
                  )}

                  {!festDismissed && (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {festIdeas.map((idea, i) => (
                        <div key={(idea.title || '') + i} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, background: '#fff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--eh-ink,#0f1128)' }}>{idea.title}</div>
                            <button type="button" className="btn btn-primary" onClick={() => applyFestivalSuggestion(idea)}
                              style={{ fontSize: 11, padding: '3px 10px', whiteSpace: 'nowrap' }}>Use this</button>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--eh-muted,#64748b)', marginTop: 3 }}>
                            {[idea.activityName, idea.format, idea.priority, idea.duration].filter(Boolean).join(' · ')}
                            {idea.activityId ? ' · verified existing activity' : ''}
                          </div>
                          {idea.objective && <div style={{ fontSize: 12, marginTop: 5 }}><strong>Objective:</strong> {idea.objective}</div>}
                          {idea.rationale && <div style={{ fontSize: 12, marginTop: 3, color: '#334155' }}><strong>Why:</strong> {idea.rationale}</div>}
                          {idea.audience && <div style={{ fontSize: 12, marginTop: 3 }}><strong>Who benefits:</strong> {idea.audience}</div>}
                          {Array.isArray(idea.materials) && idea.materials.length > 0 && (
                            <div style={{ fontSize: 12, marginTop: 3 }}><strong>Materials:</strong> {idea.materials.join(', ')}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="field"><label>Activity</label>
                <ActivitySelect
                  value={form.activityName || ''}
                  onChange={pickActivity}
                  activities={allActivities}
                  sectors={sectors}
                  ngoId={ngoId}
                  selectedSectorId={form.sector_id}
                />
                {inlineSuggestion('activityName')}
              </div>
              <div className="field"><label>Category</label>
                <input name="category" value={form.category} onChange={handleChange} list="cat-list" placeholder="Type or pick a category" />
                <datalist id="cat-list">{CATEGORIES.map(c => <option key={c} value={c} />)}</datalist>
                {inlineSuggestion('category')}
              </div>
            </div>

            <div className="form-row">
              <div className="field"><label>Event Date *</label>
                <input type="date" name="date" value={form.date} onChange={handleChange} required ref={registerField('date')} style={fieldStyle('date')} />
                {fieldError('date')}
              </div>
              <div className="field"><label>Priority</label><select name="priority" value={form.priority} onChange={handleChange}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Location Decided</label><input name="venue" value={form.venue} onChange={handleChange} placeholder="Venue / full address" />{inlineSuggestion('venue')}</div>
            </div>

              </>
            )}

            {step === 2 && (
              <>
            {section('Volunteer Requirement')}
            <div className="form-row">
              <div className="field"><label>Number of Volunteers Required</label>
                <input type="number" min="0" name="volunteers_required" value={planning.volunteers_required} onChange={e => updatePlanning({ volunteers_required: e.target.value })} placeholder="e.g. 10" />
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <VoluntaryPicker ngoId={form.ngo_id} value={volunteers} onChange={setVolunteers} />
            </div>

            {section('Beneficiary Details')}
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Beneficiary Categories</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {BENEFICIARY_CATEGORIES.map(cat => {
                  const on = planning.beneficiary_categories.includes(cat)
                  return (
                    <label key={cat} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
                      padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                      border: `1px solid ${on ? 'var(--eh-primary,#2036bd)' : 'var(--eh-line,#e8e6f2)'}`,
                      background: on ? 'var(--eh-primary-soft,#e8ecfb)' : 'var(--eh-surface-2,#fff)',
                      color: on ? 'var(--eh-primary,#2036bd)' : 'var(--eh-ink-soft,#6a6f8f)',
                    }}>
                      <input type="checkbox" checked={on} onChange={() => toggleBeneficiaryCategory(cat)} style={{ accentColor: 'var(--eh-primary,#2036bd)' }} />
                      {cat}
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="form-row">
              <div className="field"><label>Number of Beneficiaries Required</label>
                <input type="number" min="0" name="expected_beneficiaries" value={form.expected_beneficiaries} onChange={handleChange} placeholder="e.g. 50" />
              </div>
            </div>

              </>
            )}

            {step === 3 && (
              <>
            {section('Distribution / Service Details')}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                <thead>
                  <tr style={{ background: 'var(--eh-surface-1,#f6f7f9)', textAlign: 'left' }}>
                    <th style={planTh(52)}>Sr. No</th>
                    <th style={planTh()}>Item / Service</th>
                    <th style={planTh(150)}>Quantity Required</th>
                    <th style={planTh(40)}></th>
                  </tr>
                </thead>
                <tbody>
                  {planning.distribution_items.map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...planTd, textAlign: 'center', color: 'var(--eh-ink-soft,#6a6f8f)', fontWeight: 600 }}>{i + 1}</td>
                      <td style={planTd}><input value={row.item} onChange={e => updateDistributionRow(i, { item: e.target.value })} placeholder="Item or service" style={planCellInput} /></td>
                      <td style={planTd}><input value={row.qty} onChange={e => updateDistributionRow(i, { qty: e.target.value })} placeholder="Qty" style={planCellInput} /></td>
                      <td style={{ ...planTd, textAlign: 'center' }}>
                        <button type="button" onClick={() => removeDistributionRow(i)} title="Remove row" disabled={planning.distribution_items.length <= 1}
                          style={{ border: 'none', background: 'transparent', color: '#b91c1c', fontSize: 14, cursor: planning.distribution_items.length <= 1 ? 'not-allowed' : 'pointer', opacity: planning.distribution_items.length <= 1 ? 0.4 : 1 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="eh-btn" onClick={addDistributionRow} style={{ marginTop: 8 }}>+ Add row</button>

            {section('Additional Requirements')}
            <div className="form-row">
              <div className="field" style={{ flex: '1 1 100%' }}>
                <label>Special Requirements / Arrangements</label>
                <textarea name="special_requirements" value={planning.special_requirements} onChange={e => updatePlanning({ special_requirements: e.target.value })} rows={3} placeholder="Any special arrangement, accessibility or material needed" style={taStyle} />
              </div>
            </div>
            <div className="form-row">
              <div className="field"><label>Organizer</label><input name="organizer" value={form.organizer} onChange={handleChange} />{inlineSuggestion('organizer')}</div>
              <div className="field"><label>Event Manager</label><input name="event_manager" value={form.event_manager} onChange={handleChange} />{inlineSuggestion('event_manager')}</div>
            </div>
            <div className="form-row">
              <div className="field"><label>Coordinator</label><input name="coordinator" value={form.coordinator} onChange={handleChange} />{inlineSuggestion('coordinator')}</div>
            </div>

              </>
            )}

            {step === 4 && (
              <>
            {section('General Checklist')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { group: 'Setup', title: 'Setup & Coordination', hint: 'Steps to complete before the event' },
                { group: 'Material', title: 'Materials', hint: 'Tick the material you are carrying' },
              ].map(sectionDef => {
                const rows = checklist.filter(c => c.group === sectionDef.group)
                if (!rows.length) return null
                const doneCount = rows.filter(c => c.status).length
                return (
                  <div key={sectionDef.group}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--eh-ink,#0f1128)' }}>{sectionDef.title}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--eh-ink-soft,#6a6f8f)' }}>
                        {sectionDef.hint} · {doneCount}/{rows.length} done
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {rows.map(item => (
                        <div key={item.key} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                          background: 'var(--eh-surface-2,#fff)', border: '1px solid var(--eh-line,#e8e6f2)', borderRadius: 11,
                          opacity: item.status ? 0.7 : 1, flexWrap: 'wrap'
                        }}>
                          <input
                            type="checkbox"
                            checked={!!item.status}
                            onChange={() => setChecklist(checklist.map(c => c.key === item.key ? { ...c, status: !c.status } : c))}
                            style={{ width: 18, height: 18, accentColor: 'var(--eh-success,#16a34a)', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, textDecoration: item.status ? 'line-through' : 'none', color: item.status ? 'var(--eh-ink-soft,#6a6f8f)' : 'var(--eh-ink,#0f1128)' }}>
                              {item.label}
                            </div>
                            <input
                              value={item.notes || ''}
                              onChange={e => setChecklist(checklist.map(c => c.key === item.key ? { ...c, notes: e.target.value } : c))}
                              placeholder={item.status ? 'Note saved (uncheck to edit)…' : 'Add note…'}
                              disabled={!!item.status}
                              style={{
                                marginTop: 6, width: '100%', maxWidth: 460, padding: '6px 10px',
                                fontSize: 12, border: '1px solid var(--eh-line,#e8e6f2)', borderRadius: 8,
                                background: item.status ? 'rgba(0,0,0,.03)' : '#fff', fontFamily: 'inherit'
                              }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
              <div style={{ fontSize: 12, color: 'var(--eh-ink-soft,#6a6f8f)' }}>Tick items already arranged — they will be saved to this event's checklist when you create it.</div>
            </div>

            {section('Banner')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              {['banner', 'photo'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setBannerType(t)}
                  style={{
                    padding: '6px 14px', borderRadius: 999,
                    border: `1px solid ${bannerType === t ? 'var(--eh-primary,#2036bd)' : 'var(--eh-line,#e8e6f2)'}`,
                    background: bannerType === t ? 'var(--eh-primary-soft,#e8ecfb)' : 'var(--eh-surface-2,#fff)',
                    color: bannerType === t ? 'var(--eh-primary,#2036bd)' : 'var(--eh-ink-soft,#6a6f8f)',
                    fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize'
                  }}
                >
                  {t === 'banner' ? '🏞 Banner' : '📷 Photo'}
                </button>
              ))}
            </div>
            <div
              tabIndex={0}
              onPaste={onBannerPaste}
              onDragOver={e => { e.preventDefault(); if (!bannerUploading) setBannerDropActive(true) }}
              onDragLeave={() => setBannerDropActive(false)}
              onDrop={e => {
                e.preventDefault()
                setBannerDropActive(false)
                const f = e.dataTransfer?.files?.[0]
                if (f) uploadBanner(f)
              }}
              style={{
                marginTop: 10, padding: 14, borderRadius: 12, textAlign: 'center',
                border: `2px dashed ${bannerDropActive ? 'var(--eh-primary,#2036bd)' : 'var(--eh-line,#e8e6f2)'}`,
                background: bannerDropActive ? 'var(--eh-primary-soft,#e8ecfb)' : 'var(--eh-surface-1,#f6f7f9)',
                transition: 'background .15s, border-color .15s',
              }}
            >
              {/* Local object URL while uploading, then the stored URL. */}
              {(bannerLocalUrl || form.banner) && (
                <div style={{ position: 'relative', marginBottom: bannerLoadError ? 0 : 12 }}>
                  {bannerLoadError ? (
                    // A broken URL used to be hidden silently, which just looked
                    // like the upload never worked. Say so, and keep the value so
                    // the event is not left with an invisible banner.
                    <div style={{
                      padding: '18px 12px', borderRadius: 10, fontSize: 12.5, textAlign: 'left',
                      background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412',
                    }}>
                      <b>The image could not be displayed.</b> It may still be attached to the event, but it
                      could not be loaded from storage. Replace it, or remove it and upload again.
                      {form.banner && (
                        <div style={{ marginTop: 6, fontSize: 11, wordBreak: 'break-all', opacity: .8 }}>{form.banner}</div>
                      )}
                    </div>
                  ) : (
                    <img
                      src={bannerLocalUrl || form.banner}
                      alt={`${bannerType} preview`}
                      onError={() => setBannerLoadError(true)}
                      style={{
                        width: '100%', maxHeight: 300, objectFit: 'contain', objectPosition: 'center top',
                        borderRadius: 10, display: 'block', background: '#fff',
                        border: '1px solid var(--eh-line,#e8e6f2)',
                        opacity: bannerUploading ? .55 : 1,
                      }}
                    />
                  )}
                  {bannerUploading && (
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 4,
                      background: 'rgba(255,255,255,.72)', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                      color: 'var(--eh-ink,#0f1128)',
                    }}>
                      <span>Uploading…</span>
                      {bannerMeta && <span style={{ fontWeight: 400, color: 'var(--eh-ink-soft,#6a6f8f)' }}>{bannerMeta.name} · {formatBytes(bannerMeta.size)}</span>}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button type="button" className="eh-btn" disabled={bannerUploading} onClick={() => bannerFileRef.current?.click()}>
                  {bannerUploading ? 'Uploading…' : (form.banner ? 'Replace image' : 'Choose image')}
                </button>
                <input
                  ref={bannerFileRef}
                  type="file"
                  hidden
                  accept="image/*"
                  onChange={e => { uploadBanner(e.target.files[0] || null) }}
                />
                {(form.banner || bannerLocalUrl) && (
                  <button type="button" className="eh-btn" disabled={bannerUploading} onClick={clearBanner}>Remove</button>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--eh-ink-soft,#6a6f8f)' }}>
                Drag an image here, paste with Ctrl+V, or use the button. JPG, PNG or WebP up to 50 MB.
                {bannerMeta?.slow && bannerUploading ? ' This is a large file, so it may take a while.' : ''}
              </div>
            </div>
            {bannerError && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 9, padding: '8px 10px' }}>
                {bannerError}
              </div>
            )}

              </>
            )}

            <div className="eh-toolbar eh-wizard-foot">
              <span className="eh-wizard-hint">
                Not finished yet? <b>Save Draft</b> keeps everything you have typed and opens the event so you can complete it later.
              </span>
              <div className="eh-wizard-actions">
                {step > 1 && (
                  <button type="button" className="eh-btn" disabled={saving || savingDraft} onClick={prev}>← Back</button>
                )}
                <button type="button" className="eh-btn" disabled={saving || savingDraft} onClick={() => persist(true)}>
                  {savingDraft ? 'Saving draft…' : 'Save Draft'}
                </button>
                {step < STEP_COUNT ? (
                  <button type="button" className="eh-btn eh-btn-primary" disabled={saving || savingDraft} onClick={next}>Next →</button>
                ) : (
                  <button type="submit" className="eh-btn eh-btn-primary" disabled={saving || savingDraft}>{saving ? 'Creating…' : 'Create Event'}</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </form>
    </>
  )
}
