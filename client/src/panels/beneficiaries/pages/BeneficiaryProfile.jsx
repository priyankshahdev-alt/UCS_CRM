import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useBnfBase } from '../bnfUi'
import { apiGet, apiPatch, apiPost, apiPut, apiDelete } from '../store'

const styles = {
  card: { background: 'var(--card-bg)', boxShadow: 'var(--shadow)', borderRadius: 'var(--radius)', border: '1px solid var(--line)', padding: '20px', marginBottom: '16px' },
  tab: (active) => ({
    padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: active ? 600 : 400,
    color: active ? 'var(--sage)' : 'var(--ink-soft)', borderBottom: active ? '2px solid var(--sage)' : '2px solid transparent',
    background: 'none', border: 'none', borderBottomWidth: '2px', borderBottomStyle: 'solid',
  }),
  field: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' },
  label: { fontSize: '12px', fontWeight: 600, color: 'var(--ink-soft)' },
  value: { fontSize: '14px', color: 'var(--ink)' },
  pill: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color: fg }),
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' },
  input: { padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', fontSize: '13px', outline: 'none', background: '#fff', color: 'var(--ink)', width: '100%', boxSizing: 'border-box' },
  btn: { padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { padding: '8px 12px', textAlign: 'left', borderBottom: '2px solid var(--line)', fontWeight: 600, color: 'var(--ink-soft)', fontSize: '11px', textTransform: 'uppercase', background: 'var(--bg)', whiteSpace: 'nowrap' },
  td: { padding: '8px 12px', borderBottom: '1px solid var(--bg)' },
}

const TABS = ['Overview', 'Personal', 'Family', 'Education', 'Disability', 'Documents', 'Programs', 'Benefits', 'Identification', 'Activity']

const STATUS_COLORS = {
  ACTIVE: ['#dcfce7', '#166534'], INACTIVE: ['var(--bg)', 'var(--ink-soft)'], SUSPENDED: ['#fef3c7', '#92400e'],
  TRANSFERRED: ['#dbeafe', '#1e40af'], DECEASED: ['#fee2e2', '#991b1b'], DUPLICATE: ['#f3e8ff', '#6b21a8'],
}

const STATUSES = Object.keys(STATUS_COLORS)
const GENDERS = ['MALE', 'FEMALE', 'TRANSGENDER', 'OTHER']

// Scalar `beneficiaries` columns that can be edited from this screen. Anything
// outside this list (code, registration date, fingerprint state, audit fields)
// is maintained by the system and stays read-only.
const EDITABLE = [
  'full_name', 'first_name', 'middle_name', 'last_name', 'date_of_birth', 'gender',
  'mobile', 'alternate_mobile', 'email', 'photo',
  'address_line_1', 'address_line_2', 'area', 'city', 'district', 'state', 'pincode',
  'occupation', 'needed', 'aadhaar_number', 'ngo_id', 'status',
  'mother_name', 'father_name', 'guardian_name', 'guardian_occupation',
  'total_family_members', 'monthly_family_income', 'income_category',
  'bpl_available', 'ration_card_available',
]

const BOOL_FIELDS = ['bpl_available', 'ration_card_available']
const NUM_FIELDS = ['total_family_members', 'monthly_family_income']

const EDUCATION_FIELDS = ['education_level', 'currently_studying', 'school_or_institute', 'grade', 'course', 'special_skills', 'training_details', 'remarks']
const EMPLOYMENT_FIELDS = ['employment_status', 'occupation', 'employer', 'employment_type', 'monthly_income', 'skills', 'remarks']
const DISABILITY_FIELDS = ['disability_type', 'disability_percentage', 'certificate_available', 'certificate_number', 'certificate_issue_date', 'certificate_validity', 'issuing_authority', 'remarks']
const FAMILY_FIELDS = ['name', 'relationship', 'date_of_birth', 'gender', 'occupation', 'mobile', 'is_dependent', 'remarks']

const str = (v) => (v == null ? '' : String(v))
const bool = (v) => !!v

function Field({ label, children }) {
  return <div style={styles.field}><label style={styles.label}>{label}</label><div style={styles.value}>{children || '-'}</div></div>
}

export default function BeneficiaryProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const base = useBnfBase()
  const [tab, setTab] = useState('Overview')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [form, setForm] = useState({})
  const [edu, setEdu] = useState({})
  const [emp, setEmp] = useState({})
  const [disabilities, setDisabilities] = useState([])
  const [familyRows, setFamilyRows] = useState([])
  const [removedFamily, setRemovedFamily] = useState([])
  const [ngoOptions, setNgoOptions] = useState([])

  const loadBeneficiary = useCallback(async () => {
    try {
      const result = await apiGet(`/beneficiaries/${id}`)
      setData(result)
    } catch (e) {
      console.error('Failed to load beneficiary:', e)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadBeneficiary() }, [loadBeneficiary])

  // The assigned NGO is edited as a dropdown, so the NGO master list is
  // fetched the first time the form is opened. "Needed Type" is free text
  // and is unrelated to the NGO.
  useEffect(() => {
    if (!editing || ngoOptions.length > 0) return
    apiGet('/ngos/options')
      .then((list) => setNgoOptions(Array.isArray(list) ? list : []))
      .catch(() => setNgoOptions([]))
  }, [editing, ngoOptions.length])

  const startEdit = () => {
    const f = {}
    for (const k of EDITABLE) f[k] = data[k] == null ? '' : data[k]
    setForm(f)
    setEdu(Object.fromEntries(EDUCATION_FIELDS.map((k) => [k, data.education?.[k] ?? (k === 'currently_studying' ? false : '')])))
    setEmp(Object.fromEntries(EMPLOYMENT_FIELDS.map((k) => [k, data.employment?.[k] ?? ''])))
    setDisabilities((data.disabilities || []).map((d) => ({ ...d })))
    setFamilyRows((data.family || []).map((m) => ({ ...m })))
    setRemovedFamily([])
    setSaveError(null)
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setSaveError(null) }

  const setField = (key, value) => setForm((p) => ({ ...p, [key]: value }))

  const sameValue = (a, b) => str(a).trim() === str(b).trim()

  const save = async () => {
    if (saving) return
    setSaving(true); setSaveError(null)
    try {
      const payload = {}
      for (const k of EDITABLE) {
        let v = form[k]
        if (BOOL_FIELDS.includes(k)) v = bool(v)
        else if (NUM_FIELDS.includes(k)) v = v === '' ? null : Number(v)
        else v = v === '' ? null : v
        if (!sameValue(v, data[k])) payload[k] = v
      }
      if (Object.keys(payload).length > 0) {
        await apiPatch(`/beneficiaries/${id}`, payload)
      }

      const eduChanged = EDUCATION_FIELDS.some((k) => !sameValue(edu[k], data.education?.[k]))
      if (eduChanged) {
        const body = {}
        for (const k of EDUCATION_FIELDS) body[k] = k === 'currently_studying' ? bool(edu[k]) : (edu[k] === '' ? null : edu[k])
        await apiPut(`/beneficiaries/${id}/education`, body)
      }

      const empChanged = EMPLOYMENT_FIELDS.some((k) => !sameValue(emp[k], data.employment?.[k]))
      if (empChanged) {
        const body = {}
        for (const k of EMPLOYMENT_FIELDS) body[k] = emp[k] === '' ? null : emp[k]
        await apiPut(`/beneficiaries/${id}/employment`, body)
      }

      // Disability is replaced wholesale by the API, so send the whole set
      // whenever a single row changed.
      const disChanged =
        disabilities.length !== (data.disabilities || []).length ||
        disabilities.some((d, i) => {
          const prev = (data.disabilities || [])[i] || {}
          return DISABILITY_FIELDS.some((k) => !sameValue(d[k], prev[k]))
        })
      if (disChanged) {
        const body = disabilities
          .filter((d) => str(d.disability_type).trim() !== '')
          .map((d) => Object.fromEntries(DISABILITY_FIELDS.map((k) => {
            let v = d[k]
            if (k === 'certificate_available') v = bool(v)
            else if (k === 'disability_percentage') v = v === '' || v == null ? null : Number(v)
            else v = v === '' ? null : v
            return [k, v]
          })))
        await apiPatch(`/beneficiaries/${id}`, { disabilities: body })
      }

      for (const m of familyRows) {
        if (m._isNew) {
          if (!str(m.name).trim()) continue
          const body = Object.fromEntries(FAMILY_FIELDS.map((k) => [k, k === 'is_dependent' ? bool(m[k]) : (m[k] === '' ? null : m[k])]))
          await apiPost(`/beneficiaries/${id}/family`, body)
        } else if (m._isDirty) {
          const body = Object.fromEntries(FAMILY_FIELDS.map((k) => [k, k === 'is_dependent' ? bool(m[k]) : (m[k] === '' ? null : m[k])]))
          await apiPatch(`/beneficiaries/family/${m.id}`, body)
        }
      }
      for (const m of removedFamily) {
        await apiDelete(`/beneficiaries/family/${m.id}`)
      }

      setEditing(false)
      await loadBeneficiary()
    } catch (e) {
      setSaveError(e.message || 'Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)' }}>Loading...</div>
  if (!data) return <div style={{ padding: '40px', textAlign: 'center', color: '#dc2626' }}>Beneficiary not found</div>

  const [bg, fg] = STATUS_COLORS[data.status] || ['var(--bg)', 'var(--ink-soft)']

  // ── Edit-mode inputs ──────────────────────────────────────────────────────
  const Text = (key, opts = {}) => (
    <input
      type={opts.type || 'text'}
      value={str(form[key])}
      placeholder={opts.placeholder}
      onChange={(e) => setField(key, e.target.value)}
      style={styles.input}
    />
  )

  const Select = (key, options, blank) => (
    <select value={str(form[key])} onChange={(e) => setField(key, e.target.value)} style={styles.input}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )

  // Same input, but bound to one of the sub-resource draft objects.
  const Text2 = (draft, setDraft, key, type) => (
    <input
      type={type || 'text'}
      value={str(draft[key])}
      onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
      style={styles.input}
    />
  )

  const Checkbox = (key) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 13 }}>
      <input type="checkbox" checked={bool(form[key])} onChange={(e) => setField(key, e.target.checked)} />
      Yes
    </label>
  )

  const E = (label, node) => <div style={styles.field}><label style={styles.label}>{label}</label>{node}</div>

  const CellInput = (value, onChange, type) => (
    <input
      type={type || 'text'}
      value={str(value)}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...styles.input, padding: '5px 8px', fontSize: 12 }}
    />
  )

  const renderTab = () => {
    switch (tab) {
      case 'Overview':
        return editing ? (
          <div style={styles.grid3}>
            <Field label="Beneficiary Code"><code style={{ fontSize: 14, fontWeight: 700 }}>{data.beneficiary_code}</code></Field>
            <E label="Status">{Select('status', STATUSES)}</E>
            <Field label="Registration Date">{data.registration_date}</Field>
            <E label="Mobile">{Text('mobile')}</E>
            <E label="Alternate Number">{Text('alternate_mobile')}</E>
            <E label="Email">{Text('email', { type: 'email' })}</E>
            <E label="City">{Text('city')}</E>
            <E label="District">{Text('district')}</E>
            <E label="State">{Text('state')}</E>
            <E label="Pincode">{Text('pincode')}</E>
            <E label="NGO">
              <select value={str(form.ngo_id)} onChange={(e) => setField('ngo_id', e.target.value)} style={styles.input}>
                <option value="">Unassigned</option>
                {ngoOptions.map((o) => <option key={o.id} value={o.id}>{o.name}{o.code ? ` (${o.code})` : ''}</option>)}
              </select>
            </E>
            <E label="Occupation">{Text('occupation')}</E>
            <E label="Needed Type">{Text('needed', { placeholder: 'What this member needs' })}</E>
            <E label="Aadhaar Number">{Text('aadhaar_number')}</E>
            <E label="Address">{Text('address_line_1')}</E>
            <E label="Address Line 2">{Text('address_line_2')}</E>
            <E label="Area / Village">{Text('area')}</E>
            <Field label="Fingerprint"><span style={styles.pill(bg, fg)}>{data.fingerprint_status}</span></Field>
            <Field label="Categories">{data.categories?.map((c) => c.name).join(', ') || 'None'}</Field>
            <Field label="Created By">{data.created_by}</Field>
          </div>
        ) : (
          <div style={styles.grid3}>
            <Field label="Beneficiary Code"><code style={{ fontSize: '14px', fontWeight: 700 }}>{data.beneficiary_code}</code></Field>
            <Field label="Status"><span style={styles.pill(bg, fg)}>{data.status}</span></Field>
            <Field label="Registration Date">{data.registration_date}</Field>
            <Field label="Mobile">{data.mobile}</Field>
            <Field label="Alternate Number">{data.alternate_mobile}</Field>
            <Field label="Email">{data.email}</Field>
            <Field label="City">{data.city}</Field>
            <Field label="District">{data.district}</Field>
            <Field label="State">{data.state}</Field>
            <Field label="Pincode">{data.pincode}</Field>
            <Field label="NGO">{data.ngos?.name || '-'}</Field>
            <Field label="Occupation">{data.occupation}</Field>
            <Field label="Needed">{data.needed}</Field>
            <Field label="Address">{data.address_line_1}</Field>
            <Field label="Aadhaar Number">{data.aadhaar_number}</Field>
            <Field label="Fingerprint"><span style={styles.pill(
              data.fingerprint_status === 'REGISTERED' ? '#dcfce7' : '#fef3c7',
              data.fingerprint_status === 'REGISTERED' ? '#166534' : '#92400e'
            )}>{data.fingerprint_status}</span></Field>
            <Field label="Categories">{data.categories?.map((c) => c.name).join(', ') || 'None'}</Field>
            <Field label="Created By">{data.created_by}</Field>
          </div>
        )
      case 'Personal':
        return editing ? (
          <div style={styles.grid2}>
            <E label="Full Name">{Text('full_name')}</E>
            <E label="First Name">{Text('first_name')}</E>
            <E label="Middle Name">{Text('middle_name')}</E>
            <E label="Last Name">{Text('last_name')}</E>
            <E label="Date of Birth">{Text('date_of_birth', { type: 'date' })}</E>
            <E label="Gender">{Select('gender', GENDERS, 'Select')}</E>
            <E label="Email">{Text('email', { type: 'email' })}</E>
            <E label="Photo URL">{Text('photo')}</E>
          </div>
        ) : (
          <div style={styles.grid2}>
            <Field label="Full Name">{data.full_name}</Field>
            <Field label="First Name">{data.first_name}</Field>
            <Field label="Middle Name">{data.middle_name}</Field>
            <Field label="Last Name">{data.last_name}</Field>
            <Field label="Date of Birth">{data.date_of_birth}</Field>
            <Field label="Gender">{data.gender}</Field>
            <Field label="Email">{data.email}</Field>
            <Field label="Photo">{data.photo ? <img src={data.photo} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover' }} /> : '-'}</Field>
          </div>
        )
      case 'Family':
        return editing ? (
          <div>
            <div style={styles.grid3}>
              <E label="Mother Name">{Text('mother_name')}</E>
              <E label="Father Name">{Text('father_name')}</E>
              <E label="Guardian Name">{Text('guardian_name')}</E>
              <E label="Guardian Occupation">{Text('guardian_occupation')}</E>
              <E label="Total Family Members">{Text('total_family_members', { type: 'number' })}</E>
              <E label="Monthly Income">{Text('monthly_family_income', { type: 'number' })}</E>
              <E label="Income Category">{Text('income_category')}</E>
              <E label="BPL Available">{Checkbox('bpl_available')}</E>
              <E label="Ration Card Available">{Checkbox('ration_card_available')}</E>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0 8px' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Family Members</h4>
              <button
                type="button"
                onClick={() => setFamilyRows((p) => [...p, { _isNew: true, name: '', relationship: '', is_dependent: false }])}
                style={{ ...styles.btn, marginLeft: 'auto', background: 'var(--bg)', color: 'var(--ink)' }}
              >
                + Add Member
              </button>
            </div>

            {familyRows.length === 0 ? (
              <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>No family members recorded</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Relationship</th>
                      <th style={styles.th}>DOB</th>
                      <th style={styles.th}>Gender</th>
                      <th style={styles.th}>Occupation</th>
                      <th style={styles.th}>Mobile</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {familyRows.map((m, i) => (
                      <tr key={m.id ?? `new-${i}`}>
                        <td style={styles.td}>{CellInput(m.name, (v) => setFamilyRows((p) => p.map((r, j) => (j === i ? { ...r, name: v, _isDirty: true } : r))))}</td>
                        <td style={styles.td}>{CellInput(m.relationship, (v) => setFamilyRows((p) => p.map((r, j) => (j === i ? { ...r, relationship: v, _isDirty: true } : r))))}</td>
                        <td style={styles.td}>{CellInput(m.date_of_birth, (v) => setFamilyRows((p) => p.map((r, j) => (j === i ? { ...r, date_of_birth: v, _isDirty: true } : r))), 'date')}</td>
                        <td style={styles.td}>
                          <select
                            value={str(m.gender)}
                            onChange={(e) => setFamilyRows((p) => p.map((r, j) => (j === i ? { ...r, gender: e.target.value, _isDirty: true } : r)))}
                            style={{ ...styles.input, padding: '5px 8px', fontSize: 12 }}
                          >
                            <option value="">-</option>
                            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </td>
                        <td style={styles.td}>{CellInput(m.occupation, (v) => setFamilyRows((p) => p.map((r, j) => (j === i ? { ...r, occupation: v, _isDirty: true } : r))))}</td>
                        <td style={styles.td}>{CellInput(m.mobile, (v) => setFamilyRows((p) => p.map((r, j) => (j === i ? { ...r, mobile: v, _isDirty: true } : r))))}</td>
                        <td style={styles.td}>
                          <span
                            onClick={() => {
                              if (m.id) setRemovedFamily((p) => [...p, m])
                              setFamilyRows((p) => p.filter((_, j) => j !== i))
                            }}
                            style={{ color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                          >
                            Remove
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {removedFamily.length > 0 && (
              <p style={{ fontSize: 12, color: '#92400e', marginTop: 8 }}>
                {removedFamily.length} family member(s) will be removed when you save.
              </p>
            )}
          </div>
        ) : (
          <div>
            <div style={styles.grid2}>
              <Field label="Mother Name">{data.mother_name}</Field>
              <Field label="Father Name">{data.father_name}</Field>
              <Field label="Guardian Name">{data.guardian_name}</Field>
              <Field label="Guardian Occupation">{data.guardian_occupation}</Field>
              <Field label="Total Family Members">{data.total_family_members}</Field>
              <Field label="Monthly Income">{data.monthly_family_income}</Field>
              <Field label="Income Category">{data.income_category}</Field>
              <Field label="BPL">{data.bpl_available ? 'Yes' : 'No'}</Field>
            </div>
            {data.family?.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Family Members</h4>
                <table style={styles.table}>
                  <thead><tr><th style={styles.th}>Name</th><th style={styles.th}>Relationship</th><th style={styles.th}>DOB</th><th style={styles.th}>Occupation</th></tr></thead>
                  <tbody>{data.family.map((m, i) => <tr key={i}><td style={styles.td}>{m.name}</td><td style={styles.td}>{m.relationship}</td><td style={styles.td}>{m.date_of_birth}</td><td style={styles.td}>{m.occupation}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        )
      case 'Education':
        return editing ? (
          <div>
            <div style={styles.grid2}>
              <E label="Education Level">{Text2(edu, setEdu, 'education_level')}</E>
              <E label="Currently Studying">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={bool(edu.currently_studying)} onChange={(e) => setEdu((p) => ({ ...p, currently_studying: e.target.checked }))} /> Yes
                </label>
              </E>
              <E label="School / Institute">{Text2(edu, setEdu, 'school_or_institute')}</E>
              <E label="Grade / Course">{Text2(edu, setEdu, 'grade')}</E>
              <E label="Course">{Text2(edu, setEdu, 'course')}</E>
              <E label="Skills">{Text2(edu, setEdu, 'special_skills')}</E>
              <E label="Training">{Text2(edu, setEdu, 'training_details')}</E>
            </div>
            <h4 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 8px' }}>Employment</h4>
            <div style={styles.grid2}>
              <E label="Employment Status">{Text2(emp, setEmp, 'employment_status')}</E>
              <E label="Occupation">{Text2(emp, setEmp, 'occupation')}</E>
              <E label="Employer">{Text2(emp, setEmp, 'employer')}</E>
              <E label="Employment Type">{Text2(emp, setEmp, 'employment_type')}</E>
              <E label="Monthly Income">{Text2(emp, setEmp, 'monthly_income', 'number')}</E>
              <E label="Skills">{Text2(emp, setEmp, 'skills')}</E>
            </div>
          </div>
        ) : (
          <div style={styles.grid2}>
            <Field label="Education Level">{data.education?.education_level}</Field>
            <Field label="Currently Studying">{data.education?.currently_studying ? 'Yes' : 'No'}</Field>
            <Field label="School / Institute">{data.education?.school_or_institute}</Field>
            <Field label="Grade / Course">{data.education?.grade || data.education?.course}</Field>
            <Field label="Skills">{data.education?.special_skills}</Field>
            <Field label="Training">{data.education?.training_details}</Field>
            <Field label="Employment Status">{data.employment?.employment_status}</Field>
            <Field label="Occupation">{data.employment?.occupation}</Field>
            <Field label="Employer">{data.employment?.employer}</Field>
            <Field label="Monthly Income">{data.employment?.monthly_income}</Field>
          </div>
        )
      case 'Disability':
        return editing ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Disability Details</h4>
              <button
                type="button"
                onClick={() => setDisabilities((p) => [...p, { disability_type: '', disability_percentage: '', certificate_available: false }])}
                style={{ ...styles.btn, marginLeft: 'auto', background: 'var(--bg)', color: 'var(--ink)' }}
              >
                + Add Disability
              </button>
            </div>
            {disabilities.length === 0 ? (
              <p style={{ color: 'var(--ink-soft)', fontSize: 13 }}>No disability records — add one if applicable.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Percentage</th>
                      <th style={styles.th}>Certificate No.</th>
                      <th style={styles.th}>Authority</th>
                      <th style={styles.th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {disabilities.map((d, i) => (
                      <tr key={d.id ?? `new-${i}`}>
                        <td style={styles.td}>{CellInput(d.disability_type, (v) => setDisabilities((p) => p.map((r, j) => (j === i ? { ...r, disability_type: v } : r))))}</td>
                        <td style={styles.td}>{CellInput(d.disability_percentage, (v) => setDisabilities((p) => p.map((r, j) => (j === i ? { ...r, disability_percentage: v } : r))), 'number')}</td>
                        <td style={styles.td}>{CellInput(d.certificate_number, (v) => setDisabilities((p) => p.map((r, j) => (j === i ? { ...r, certificate_number: v } : r))))}</td>
                        <td style={styles.td}>{CellInput(d.issuing_authority, (v) => setDisabilities((p) => p.map((r, j) => (j === i ? { ...r, issuing_authority: v } : r))))}</td>
                        <td style={styles.td}>
                          <span
                            onClick={() => setDisabilities((p) => p.filter((_, j) => j !== i))}
                            style={{ color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                          >
                            Remove
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div>
            {data.disabilities?.length === 0 ? <p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>No disability records</p> : (
              <table style={styles.table}>
                <thead><tr><th style={styles.th}>Type</th><th style={styles.th}>Percentage</th><th style={styles.th}>Certificate</th><th style={styles.th}>Authority</th></tr></thead>
                <tbody>{data.disabilities?.map((d, i) => <tr key={i}><td style={styles.td}>{d.disability_type}</td><td style={styles.td}>{d.disability_percentage}%</td><td style={styles.td}>{d.certificate_available ? 'Yes' : 'No'}</td><td style={styles.td}>{d.issuing_authority}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )
      case 'Documents':
        return (
          <div>
            {data.documents?.length === 0 ? <p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>No documents uploaded</p> : (
              <table style={styles.table}>
                <thead><tr><th style={styles.th}>Type</th><th style={styles.th}>File</th><th style={styles.th}>Status</th><th style={styles.th}>Uploaded</th></tr></thead>
                <tbody>{data.documents?.map((d, i) => <tr key={i}><td style={styles.td}>{d.document_type}</td><td style={styles.td}>{d.file_url ? <a href={d.file_url} target="_blank" rel="noreferrer" style={{ color: 'var(--sage)', textDecoration: 'none', fontWeight: 500 }}>{d.file_name || 'Open'}</a> : (d.file_name || '-')}</td><td style={styles.td}>{d.verification_status}</td><td style={styles.td}>{d.uploaded_at}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )
      case 'Programs':
        return <div><p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>Program history will appear here</p></div>
      case 'Benefits':
        return (
          <div>
            {data.distributions?.length === 0 ? <p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>No distributions yet</p> : (
              <table style={styles.table}>
                <thead><tr><th style={styles.th}>Distribution #</th><th style={styles.th}>Date</th><th style={styles.th}>Program</th><th style={styles.th}>Status</th></tr></thead>
                <tbody>{data.distributions?.map((d, i) => <tr key={i}><td style={styles.td}>{d.distribution_number}</td><td style={styles.td}>{d.distribution_date}</td><td style={styles.td}>{d.bnf_programs?.title || '-'}</td><td style={styles.td}>{d.status}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )
      case 'Identification':
        return (
          <div style={styles.grid2}>
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>QR Card</h4>
              {data.activeCard ? (
                <div><p>Card: {data.activeCard.card_number}</p><p>Token: {data.activeCard.qr_token?.slice(0, 8)}...</p></div>
              ) : <p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>No card issued</p>}
            </div>
            <div>
              <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Biometric</h4>
              <p>Status: {data.biometric?.status}</p>
              <p>Enrolled fingers: {data.biometric?.enrolled_fingers?.length || 0}</p>
            </div>
          </div>
        )
      case 'Activity':
        return <div><p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>Audit trail will appear here</p></div>
      default:
        return null
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <button onClick={() => navigate(base + '/all')} style={{ background: 'none', border: 'none', color: 'var(--sage)', cursor: 'pointer', fontSize: '13px', marginBottom: '4px' }}>← Back to list</button>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>{data.full_name}</h2>
          <div style={{ fontSize: '13px', color: 'var(--ink-soft)', marginTop: '4px' }}>
            <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{data.beneficiary_code}</code>
            <span style={{ marginLeft: '8px' }}><span style={styles.pill(bg, fg)}>{data.status}</span></span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {editing ? (
            <>
              <button onClick={cancelEdit} disabled={saving} style={{ ...styles.btn, background: 'var(--bg)', color: 'var(--ink)' }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ ...styles.btn, background: 'var(--sage)', color: '#fff' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </>
          ) : (
            <button onClick={startEdit} style={{ ...styles.btn, background: 'var(--sage)', color: '#fff' }}>Edit</button>
          )}
        </div>
      </div>

      {saveError && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 13, marginBottom: '12px' }}>
          {saveError}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--line)', marginBottom: '16px', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={styles.tab(tab === t)}>{t}</button>
        ))}
      </div>

      <div style={styles.card}>{renderTab()}</div>
    </div>
  )
}
