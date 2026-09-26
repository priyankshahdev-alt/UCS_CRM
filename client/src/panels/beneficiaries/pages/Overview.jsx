import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBnfBase } from '../bnfUi'
import { apiGet } from '../store'

const STATUS_COLORS = {
  ACTIVE: ['#dcfce7', '#166534'],
  INACTIVE: ['var(--bg)', 'var(--ink-soft)'],
  SUSPENDED: ['#fef3c7', '#92400e'],
  DECEASED: ['#fee2e2', '#991b1b'],
  TRANSFERRED: ['#dbeafe', '#1e40af'],
  DUPLICATE: ['#f3e8ff', '#6b21a8'],
}

const styles = {
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' },
  statCard: { background: 'var(--card-bg)', boxShadow: 'var(--shadow)', borderRadius: 'var(--radius)', padding: '20px', border: '1px solid var(--line)' },
  statLabel: { fontSize: '12px', color: 'var(--ink-soft)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  statValue: { fontSize: '28px', fontWeight: 700, color: 'var(--ink)' },
  card: { background: 'var(--card-bg)', boxShadow: 'var(--shadow)', borderRadius: 'var(--radius)', border: '1px solid var(--line)', padding: '20px', marginBottom: '16px' },
  cardTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '16px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid var(--line)', fontWeight: 600, color: 'var(--ink-soft)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--bg)' },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--bg)', color: 'var(--ink)' },
  pill: (color) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: color + '20', color }),
  pillBg: (bg, fg) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600, background: bg, color: fg }),
  btn: { padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  row: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' },
  subLabel: { color: 'var(--ink-soft)' },
  subValue: { fontWeight: 600 },
  sectionTitle: { fontSize: '20px', fontWeight: 700, color: 'var(--ink)', margin: 0 },
}

export default function Overview() {
  const navigate = useNavigate()
  const base = useBnfBase()
  const [stats, setStats] = useState(null)
  const [reports, setReports] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const data = await apiGet('/beneficiaries/overview')
      setStats(data)
      const [b, p, d, v] = await Promise.allSettled([
        apiGet('/reports/beneficiaries'),
        apiGet('/reports/programs'),
        apiGet('/reports/distributions'),
        apiGet('/reports/volunteers'),
      ])
      setReports({
        beneficiaries: b.status === 'fulfilled' ? b.value : null,
        programs: p.status === 'fulfilled' ? p.value : null,
        distributions: d.status === 'fulfilled' ? d.value : null,
        volunteers: v.status === 'fulfilled' ? v.value : null,
      })
    } catch (e) {
      console.error('Failed to load overview:', e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)' }}>Loading...</div>

  const b = reports?.beneficiaries
  const p = reports?.programs
  const d = reports?.distributions
  const v = reports?.volunteers
  const benTotal = b?.summary?.total || 0
  const noData = <div style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>No data available</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={styles.sectionTitle}>Beneficiaries Overview</h2>
      </div>

      <div style={styles.statsGrid}>
        <button
          type="button"
          onClick={() => navigate(base + '/all')}
          title="View all members"
          style={{ ...styles.statCard, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', display: 'block', width: '100%' }}
        >
          <div style={{ ...styles.statLabel, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Total Members</span>
            <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--sage)', fontWeight: 600 }}>View all →</span>
          </div>
          <div style={{ ...styles.statValue, color: 'var(--sage)' }}>{stats?.total_beneficiaries || 0}</div>
        </button>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Active</div>
          <div style={{ ...styles.statValue, color: '#059669' }}>{stats?.active || 0}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Inactive</div>
          <div style={{ ...styles.statValue, color: '#dc2626' }}>{stats?.inactive || 0}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>New This Month</div>
          <div style={{ ...styles.statValue, color: '#7c3aed' }}>{stats?.new_this_month || 0}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Pending Fingerprint</div>
          <div style={{ ...styles.statValue, color: '#d97706' }}>{stats?.pending_fingerprint || 0}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Events</div>
          <div style={{ ...styles.statValue, color: '#0891b2' }}>{stats?.programs || 0}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Benefits Distributed</div>
          <div style={{ ...styles.statValue, color: '#be185d' }}>{stats?.benefits_distributed || 0}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={styles.card}>
          <div style={styles.cardTitle}>Quick Actions</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => navigate(base + '/all')} style={{ ...styles.btn, background: 'var(--bg)', color: 'var(--ink)' }}>View All</button>
            <button onClick={() => navigate(base + '/import')} style={{ ...styles.btn, background: 'var(--sage)', color: '#fff' }}>Import Members</button>
          </div>
        </div>

        <div style={styles.card}>
          <div style={styles.cardTitle}>System Status</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: 'var(--ink-soft)' }}>Biometric Enrollment</span>
              <span style={styles.pill(stats?.pending_fingerprint > 0 ? '#d97706' : '#059669')}>
                {stats?.pending_fingerprint > 0 ? `${stats.pending_fingerprint} pending` : 'All enrolled'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: 'var(--ink-soft)' }}>Active Beneficiaries</span>
              <span style={styles.pill('#059669')}>{stats?.active || 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: 'var(--ink-soft)' }}>Total Events</span>
              <span style={styles.pill('var(--sage)')}>{stats?.programs || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Reports */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '32px 0 16px' }}>
        <h2 style={styles.sectionTitle}>Reports</h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Beneficiary Breakdown */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Beneficiary Status Breakdown</div>
          {b ? (
            <>
              <table style={styles.table}>
                <thead><tr><th style={styles.th}>Status</th><th style={styles.th}>Count</th><th style={styles.th}>%</th></tr></thead>
                <tbody>
                  {Object.entries(STATUS_COLORS).map(([status, [bg, fg]]) => {
                    const count = b.summary?.[status] || 0
                    const pct = benTotal > 0 ? Math.round((count / benTotal) * 100) : 0
                    return (
                      <tr key={status}>
                        <td style={styles.td}><span style={styles.pillBg(bg, fg)}>{status}</span></td>
                        <td style={styles.td}>{count}</td>
                        <td style={styles.td}>{pct}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: '12px', borderTop: '1px solid var(--bg)', paddingTop: '12px' }}>
                <div style={styles.row}>
                  <span style={styles.subLabel}>Biometric Registered</span>
                  <span style={styles.subValue}>{b.biometric?.registered || 0}</span>
                </div>
                <div style={{ ...styles.row, marginBottom: 0 }}>
                  <span style={styles.subLabel}>Biometric Pending</span>
                  <span style={styles.subValue}>{b.biometric?.pending || 0}</span>
                </div>
              </div>
            </>
          ) : noData}
        </div>

        {/* Event Reports */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Event Summary</div>
          {p ? (
            <>
              <div style={styles.row}>
                <span style={styles.subLabel}>Total Events</span>
                <span style={styles.subValue}>{p.summary?.total_programs || 0}</span>
              </div>
              <div style={styles.row}>
                <span style={styles.subLabel}>Beneficiaries Served</span>
                <span style={styles.subValue}>{p.summary?.total_beneficiaries_served || 0}</span>
              </div>
              <div style={{ ...styles.row, marginBottom: 0 }}>
                <span style={styles.subLabel}>Distributions</span>
                <span style={styles.subValue}>{p.summary?.total_distributions || 0}</span>
              </div>
            </>
          ) : noData}
        </div>

        {/* Distribution Reports */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Distribution Summary</div>
          {d ? (
            <>
              <div style={styles.row}>
                <span style={styles.subLabel}>Total Distributions</span>
                <span style={styles.subValue}>{d.summary?.total_distributions || 0}</span>
              </div>
              <div style={styles.row}>
                <span style={styles.subLabel}>Completed</span>
                <span style={styles.pillBg('#dcfce7', '#166534')}>{d.summary?.completed || 0}</span>
              </div>
              <div style={styles.row}>
                <span style={styles.subLabel}>Reversed</span>
                <span style={styles.pillBg('#fee2e2', '#991b1b')}>{d.summary?.reversed || 0}</span>
              </div>
              {d.by_benefit?.length > 0 && (
                <div style={{ marginTop: '8px', borderTop: '1px solid var(--bg)', paddingTop: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)', marginBottom: '8px' }}>By Benefit Type</div>
                  {d.by_benefit.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--ink-soft)' }}>{item.benefit_name}</span>
                      <span>{item.total_distributions} · {item.total_quantity} qty</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : noData}
        </div>

        {/* Volunteer Reports */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Volunteer Summary</div>
          {v ? (
            <>
              <div style={styles.row}>
                <span style={styles.subLabel}>Total Volunteers</span>
                <span style={styles.subValue}>{v.summary?.total || 0}</span>
              </div>
              <div style={{ ...styles.row, marginBottom: 0 }}>
                <span style={styles.subLabel}>Active</span>
                <span style={styles.pillBg('#dcfce7', '#166534')}>{v.summary?.active || 0}</span>
              </div>
              {v.participation?.length > 0 && (
                <div style={{ marginTop: '8px', borderTop: '1px solid var(--bg)', paddingTop: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)', marginBottom: '8px' }}>Top Participation</div>
                  {v.participation.slice(0, 5).map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--ink-soft)' }}>{item.full_name}</span>
                      <span>{item.programs_assigned} assigned</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : noData}
        </div>
      </div>
    </div>
  )
}