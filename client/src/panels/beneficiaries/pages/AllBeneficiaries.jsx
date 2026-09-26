import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBnfBase } from '../bnfUi'
import { apiGet, apiPost } from '../store'

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  filterBar: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', fontSize: '13px', outline: 'none', minWidth: '160px' },
  btn: { padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  card: { background: 'var(--card-bg)', boxShadow: 'var(--shadow)', borderRadius: 'var(--radius)', border: '1px solid var(--line)', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid var(--line)', fontWeight: 600, color: 'var(--ink-soft)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--bg)' },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--bg)', color: 'var(--ink)' },
  pill: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: bg, color: fg }),
  link: { color: 'var(--sage)', textDecoration: 'none', cursor: 'pointer', fontWeight: 500 },
}

const STATUS_COLORS = {
  ACTIVE: ['#dcfce7', '#166534'],
  INACTIVE: ['var(--bg)', 'var(--ink-soft)'],
  SUSPENDED: ['#fef3c7', '#92400e'],
  TRANSFERRED: ['#dbeafe', '#1e40af'],
  DECEASED: ['#fee2e2', '#991b1b'],
  DUPLICATE: ['#f3e8ff', '#6b21a8'],
}

export default function AllBeneficiaries() {
  const navigate = useNavigate()
  const base = useBnfBase()
  const [data, setData] = useState({ data: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, pageSize })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      const result = await apiGet(`/beneficiaries?${params}`)
      setData(result)
    } catch (e) {
      console.error('Failed to load beneficiaries:', e)
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter])

  useEffect(() => { loadData() }, [loadData])

  const [selected, setSelected] = useState(new Set())

  const currentIds = data.data?.map((b) => b.id) || []
  const allSelected = currentIds.length > 0 && currentIds.every((id) => selected.has(id))

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(currentIds))

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return
    const ok = window.confirm(
      `Permanently delete ${selected.size} beneficiary(ies)?\n\n` +
      `This removes ALL records: profile, documents, fingerprints (biometric), disability, family, education, benefits.\n` +
      `This cannot be undone.`
    )
    if (!ok) return
    try {
      await apiPost('/beneficiaries/bulk-delete', { ids: [...selected] })
      setSelected(new Set())
      loadData()
    } catch (e) {
      console.error('Delete failed:', e)
      alert('Delete failed: ' + (e.message || 'unknown error'))
    }
  }

  const handleSearch = (e) => {
    e.preventDefault()
    setPage(1)
    loadData()
  }

  const totalPages = Math.ceil((data.total || 0) / pageSize)

  return (
    <div>
      <div style={styles.header}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)', margin: 0 }}>All Beneficiaries</h2>
        <button
          onClick={() => navigate(base + '/import')}
          style={{ ...styles.btn, background: 'var(--sage)', color: '#fff' }}
        >
          Import Members
        </button>
      </div>

      <div style={styles.filterBar}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Search by name, code, or mobile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...styles.input, minWidth: '300px' }}
          />
          <button type="submit" style={{ ...styles.btn, background: 'var(--sage)', color: '#fff' }}>Search</button>
        </form>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} style={styles.input}>
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="TRANSFERRED">Transferred</option>
          <option value="DECEASED">Deceased</option>
          <option value="DUPLICATE">Duplicate</option>
        </select>
        {selected.size > 0 && (
          <button onClick={handleDeleteSelected} style={{ ...styles.btn, background: '#dc2626', color: '#fff' }}>
            Delete Selected ({selected.size})
          </button>
        )}
        <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>{data.total || 0} beneficiaries</span>
      </div>

      <div style={styles.card}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)' }}>Loading...</div>
        ) : data.data?.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)' }}>No beneficiaries found</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...styles.table, minWidth: 1500 }}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th style={styles.th}>Code</th>
                  <th style={styles.th}>Name</th>
                  <th style={styles.th}>Mobile</th>
                  <th style={styles.th}>NGO</th>
                  <th style={styles.th}>Gender</th>
                  <th style={styles.th}>DOB</th>
                  <th style={styles.th}>Occupation</th>
                  <th style={styles.th}>Address</th>
                  <th style={styles.th}>Pincode</th>
                  <th style={styles.th}>Aadhaar No.</th>
                  <th style={styles.th}>Needed</th>
                  <th style={styles.th}>City</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Fingerprint</th>
                  <th style={styles.th}>Registered</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data?.map((b) => {
                  const [bg, fg] = STATUS_COLORS[b.status] || ['var(--bg)', 'var(--ink-soft)']
                  return (
                    <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => navigate(base + `/${b.id}`)}>
                      <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggleSelect(b.id)} />
                      </td>
                      <td style={styles.td}><code style={{ fontSize: '12px', background: 'var(--bg)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{b.beneficiary_code}</code></td>
                      <td style={styles.td}><span style={styles.link}>{b.full_name}</span></td>
                      <td style={styles.td}>{b.mobile || '-'}</td>
                      <td style={styles.td}>{b.ngos?.name || '-'}</td>
                      <td style={styles.td}>{b.gender || '-'}</td>
                      <td style={styles.td}>{b.date_of_birth || '-'}</td>
                      <td style={styles.td}>{b.occupation || '-'}</td>
                      <td style={{ ...styles.td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.address_line_1 || '-'}</td>
                      <td style={styles.td}>{b.pincode || '-'}</td>
                      <td style={styles.td}>{b.aadhaar_number || '-'}</td>
                      <td style={{ ...styles.td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.needed || '-'}</td>
                      <td style={styles.td}>{b.city || '-'}</td>
                      <td style={styles.td}><span style={styles.pill(bg, fg)}>{b.status}</span></td>
                      <td style={styles.td}>
                        <span style={styles.pill(
                          b.fingerprint_status === 'REGISTERED' ? '#dcfce7' : b.fingerprint_status === 'REVOKED' ? '#fee2e2' : '#fef3c7',
                          b.fingerprint_status === 'REGISTERED' ? '#166534' : b.fingerprint_status === 'REVOKED' ? '#991b1b' : '#92400e'
                        )}>
                          {b.fingerprint_status === 'REGISTERED' ? '✓' : b.fingerprint_status === 'REVOKED' ? '✗' : '○'}
                        </span>
                      </td>
                      <td style={styles.td}>{b.registration_date || '-'}</td>
                      <td style={styles.td}>
                        <span onClick={(e) => { e.stopPropagation(); navigate(base + `/${b.id}`) }} style={styles.link}>View</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginTop: '16px' }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ ...styles.btn, background: 'var(--bg)', opacity: page <= 1 ? 0.5 : 1 }}>Prev</button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, totalPages - 4))
            const p = start + i
            if (p > totalPages) return null
            return (
              <button key={p} onClick={() => setPage(p)} style={{ ...styles.btn, background: p === page ? 'var(--sage)' : 'var(--bg)', color: p === page ? '#fff' : 'var(--ink)' }}>{p}</button>
            )
          })}
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ ...styles.btn, background: 'var(--bg)', opacity: page >= totalPages ? 0.5 : 1 }}>Next</button>
        </div>
      )}
    </div>
  )
}
