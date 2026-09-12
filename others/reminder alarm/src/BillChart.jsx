import { useMemo, useState } from 'react'
import { Icon } from './components'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const PERIODS = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'yearly', label: 'Yearly' },
]

const BAR_NOW = '#2563eb'
const BAR_SOFT = '#93c5fd'
const INK = '#1e293b'
const INK_SOFT = '#64748b'
const LINE = '#e2e8f0'

function toDate(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v).slice(0, 10) + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

function fmt(n) {
  if (!n) return '₹0'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

function compact(n) {
  if (!n) return '₹0'
  if (n >= 10000000) return '₹' + parseFloat((n / 10000000).toFixed(1)) + 'Cr'
  if (n >= 100000) return '₹' + parseFloat((n / 100000).toFixed(1)) + 'L'
  if (n >= 1000) return '₹' + parseFloat((n / 1000).toFixed(1)) + 'k'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

function buildBuckets(period, reminders) {
  const now = new Date()
  const buckets = []
  let start
  let bucketIndex

  if (period === 'monthly') {
    start = now.getFullYear() * 12 + now.getMonth()
    for (let i = 0; i < 6; i++) {
      const idx = start + i
      const y = Math.floor(idx / 12)
      const m = idx % 12
      buckets.push({ key: idx, label: MONTH_SHORT[m], full: `${MONTH_SHORT[m]} ${y}`, now: i === 0, value: 0 })
    }
    bucketIndex = d => d.getFullYear() * 12 + d.getMonth()
  } else if (period === 'quarterly') {
    start = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3)
    for (let i = 0; i < 4; i++) {
      const idx = start + i
      const y = Math.floor(idx / 4)
      const q = (idx % 4) + 1
      buckets.push({ key: idx, label: `Q${q}`, full: `Q${q} ${y}`, now: i === 0, value: 0 })
    }
    bucketIndex = d => d.getFullYear() * 4 + Math.floor(d.getMonth() / 3)
  } else {
    start = now.getFullYear()
    for (let i = 0; i < 4; i++) {
      const y = start + i
      buckets.push({ key: y, label: String(y), full: `Year ${y}`, now: i === 0, value: 0 })
    }
    bucketIndex = d => d.getFullYear()
  }

  for (const r of reminders) {
    const d = toDate(r._effectiveDate)
    if (!d) continue
    const bi = bucketIndex(d) - start
    if (bi >= 0 && bi < buckets.length) buckets[bi].value += r._amount || 0
  }
  return buckets
}

export default function BillChart({ reminders = [] }) {
  const [period, setPeriod] = useState('monthly')

  const buckets = useMemo(() => buildBuckets(period, reminders), [period, reminders])
  const total = useMemo(() => buckets.reduce((s, b) => s + b.value, 0), [buckets])
  const hasData = buckets.some(b => b.value > 0)

  const W = 430
  const H = 118
  const top = 22
  const bottom = 13
  const side = 6
  const plotW = W - side * 2
  const plotH = H - top - bottom
  const baselineY = top + plotH
  const step = plotW / buckets.length
  const barW = Math.min(44, step * 0.6)
  const max = Math.max(...buckets.map(b => b.value))

  const dataPoints = buckets.map((b, i) => {
    const cx = side + step * i + step / 2
    const val = Math.max(0, b.value)
    const y = val > 0 ? baselineY - (val / max) * plotH : baselineY
    return { x: cx, y, b }
  })
  const linePath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaPath = `${linePath} L ${dataPoints[dataPoints.length - 1].x} ${baselineY} L ${dataPoints[0].x} ${baselineY} Z`

  return (
    <section className="dash-section bc-card">
      <div className="sec-head">
        <h3><Icon name="money" size={16} /> Bill Chart</h3>
        <span className="sec-count">{fmt(total)}</span>
      </div>

      <div className="dash-tabs">
        {PERIODS.map(p => (
          <button key={p.key} className={period === p.key ? 'dash-tab active' : 'dash-tab'} onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
      </div>

      <div className="bc-body">
        {!hasData ? (
          <div className="bc-empty">No due amounts in this view.</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bill chart by period">
            <defs>
              <linearGradient id="bcArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={BAR_NOW} stopOpacity="0.16" />
                <stop offset="100%" stopColor={BAR_NOW} stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1={side} y1={baselineY} x2={W - side} y2={baselineY} stroke={LINE} />
            <path d={areaPath} fill="url(#bcArea)" />
            <path d={linePath} fill="none" stroke={BAR_NOW} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {dataPoints.map((p) => (
              <g key={p.b.key}>
                {p.b.value > 0 && (
                  <>
                    <circle cx={p.x} cy={p.y} r={p.b.now ? 4 : 3} fill={p.b.now ? BAR_NOW : '#fff'} stroke={BAR_NOW} strokeWidth="2">
                      <title>{`${p.b.full}: ${fmt(p.b.value)}`}</title>
                    </circle>
                    <text x={p.x} y={Math.max(p.y - 7, 9)} textAnchor="middle" fontSize="8" fontWeight="700" fill={p.b.now ? BAR_NOW : INK_SOFT}>{compact(p.b.value)}</text>
                  </>
                )}
                <text x={p.x} y={baselineY + 10} textAnchor="middle" fontSize="8" fontWeight="600" fill={INK_SOFT}>{p.b.label}</text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </section>
  )
}