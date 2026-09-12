import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPut, apiPost } from '../api/auth';
import useAccessCode from '../components/AccessGate';

const currency = n => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : '\u20B90';
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

const TEAM_STYLE = {
  UFS1: { bg: '#E7F3EC', fg: '#1f6f3f' },
  UFS2: { bg: '#EAF1FB', fg: '#2563eb' },
  UFS3: { bg: '#FDF2E3', fg: '#B45309' },
  UFS4: { bg: '#F3E8F8', fg: '#7C3AED' },
  'No Team': { bg: '#F3F4F6', fg: '#6b7280' },
};

const Sk = ({ w = '100%', h = 14, r = 6, mb = 0, style = {} }) => (
  <div className="sk" style={{ width: w, height: h, borderRadius: r, marginBottom: mb, ...style }} />
);

const TableSkeleton = ({ cols = 5, rows = 3 }) => (
  <div style={{ padding: 6 }}>
    {[...Array(rows)].map((_, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 14px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
        {[...Array(cols)].map((_, j) => (
          <Sk key={j} h={12} style={{ flex: 1, maxWidth: j === cols - 1 ? 90 : 'none' }} />
        ))}
      </div>
    ))}
  </div>
);

const StatCardSkeleton = () => (
  <div className="stat-card">
    <div className="stat-icon"><Sk w={20} h={20} r={6} /></div>
    <div className="stat-info" style={{ flex: 1 }}>
      <Sk h={22} mb={6} />
      <Sk w="60%" h={10} />
    </div>
  </div>
);

const TenorCrab = () => (
  <div className="no-print" style={{ position: 'absolute', left: 0, right: 0, bottom: 2, height: 55, pointerEvents: 'none' }}>
    <div style={{ position: 'absolute', top: 0, left: 0, width: 124, height: 55, animation: 'rpSweep 26s ease-in-out infinite' }}>
      <video
        src="https://media.tenor.com/ReQRC0WV_coAAAPo/minecraft-crab.mp4"
        poster="https://media.tenor.com/ReQRC0WV_coAAAAe/minecraft-crab.png"
        autoPlay
        loop
        muted
        playsInline
        style={{
          width: '100%', height: '100%', objectFit: 'contain',
          mixBlendMode: 'multiply', imageRendering: 'pixelated', opacity: .85
        }}
      />
    </div>
  </div>
);

const inputStyle = { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', fontWeight: 600, background: '#fff', color: 'var(--ink)' };

const printStyle = `
  @media print {
    .no-print { display: none !important; }
    body { font-family: 'Inter', sans-serif; padding: 20px; color: #000; }
    .card { border: 1px solid #ccc; border-radius: 6px; margin-bottom: 16px; }
    .card-head { padding: 10px 14px; border-bottom: 1px solid #ddd; font-size: 14px; font-weight: 600; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { padding: 6px 10px; border: 1px solid #999; text-align: left; }
    th { background: #f0f0f0; font-weight: 600; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; }
  }
`;

const animStyle = `
  @keyframes rpFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .rp-card { animation: rpFadeUp .35s ease both; }
  .rp-tabs { animation: rpFadeUp .3s ease both; }
  @keyframes rpSweep {
    0%   { left: 0; }
    12%  { left: 0; }
    45%  { left: calc(100% - 124px); }
    55%  { left: calc(100% - 124px); }
    88%  { left: 0; }
    100% { left: 0; }
  }
  @media (prefers-reduced-motion: reduce) { .rp-card, .rp-tabs, [style*="rpSweep"] { animation: none; } }
`;

export default function Reports() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [reportDay, setReportDay] = useState(null);
  const [reportFrom, setReportFrom] = useState(null);
  const [reportTo, setReportTo] = useState(null);
  const [data, setData] = useState(null);
  const [atc, setAtc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sourceTab, setSourceTab] = useState('All');
  const [viewTab, setViewTab] = useState('source');
  const [atcTab, setAtcTab] = useState('agent');
  const access = useAccessCode();
  const [locked, setLocked] = useState(true);

  const handleUnlock = async () => {
    const ok = await access.open();
    if (ok) setLocked(false);
  };
  const handleLock = () => setLocked(true);
  const mask = (v) => (locked ? 'XXXX' : v);

  // monthly target editor state
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [targetForm, setTargetForm] = useState({ overall: '', perNgo: {} });
  const [savingTarget, setSavingTarget] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  const monthLabel = useCallback((m) => {
    if (!m || !/^\d{4}-\d{2}$/.test(m)) return m || '';
    const [y, mm] = m.split('-').map(Number);
    const d = new Date(y, mm - 1, 1);
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }, []);

  const dayLabel = useCallback((d) => {
    if (!d) return '';
    const [y, mm, dd] = d.split('-').map(Number);
    return new Date(y, mm - 1, dd).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }, []);

  const rangeLabel = useCallback((f, t) => {
    if (!f || !t) return '';
    const fmt = (d) => {
      const [y, mm, dd] = d.split('-').map(Number);
      return new Date(y, mm - 1, dd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    return `${fmt(f)} – ${fmt(t)}`;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let q = `month=${month}`;
      if (reportFrom && reportTo) q = `from=${reportFrom}&to=${reportTo}`;
      else if (reportDay) q = `date=${reportDay}`;
      const res = await apiGet('/accounts/report-data?' + q);
      setData(res);
      try {
        const atcRes = await apiGet('/accounts/report-agent-team?' + q);
        setAtc(atcRes);
      } catch (e) {
        setAtc(null);
      }
    } catch (e) {
      setError(e.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [reportDay, month, reportFrom, reportTo]);

  useEffect(() => { load(); }, [reportDay, month, reportFrom, reportTo]);

  // Open target form pre-filled from saved targets (or blank for even split)
  const openTargetForm = () => {
    const ngos = data?.ngos || [];
    const byNgo = data?.byNgoTargets || {};
    const perNgo = {};
    ngos.forEach(n => { perNgo[n.id] = byNgo[n.id] != null ? String(byNgo[n.id]) : ''; });
    setTargetForm({ overall: data?.overallTarget ? String(data.overallTarget) : '', perNgo });
    setShowTargetForm(true);
    setSavedToast(false);
  };

  // When overall typed in the form -> even split across NGOs
  const onOverallChange = (val) => {
    const ngos = data?.ngos || [];
    const overall = Number(val) || 0;
    const perNgo = {};
    if (ngos.length > 0 && overall > 0) {
      const share = Math.floor(overall / ngos.length);
      let rem = overall - share * ngos.length;
      ngos.forEach((n, i) => {
        // give the remainder to the last NGO so the sum matches exactly
        perNgo[n.id] = String(share + (i === ngos.length - 1 ? rem : 0));
      });
    } else {
      ngos.forEach(n => { perNgo[n.id] = ''; });
    }
    setTargetForm({ overall: val, perNgo });
  };

  // When an individual NGO target is edited -> keep the overall as the anchor;
  // any shortfall vs the per-NGO sum is surfaced as a distribution recommendation.
  const onNgoTargetChange = (slug, val) => {
    const perNgo = { ...targetForm.perNgo, [slug]: val };
    setTargetForm({ ...targetForm, perNgo });
  };

  // Distribute the unallocated shortfall across all NGOs (a bit here and there)
  const distributeShortfall = () => {
    const ngos = data?.ngos || [];
    if (ngos.length === 0) return;
    const overall = Number(targetForm.overall) || 0;
    const allocated = ngos.reduce((s, n) => s + (Number(targetForm.perNgo[n.id]) || 0), 0);
    let short = overall - allocated;
    if (short <= 0) return;
    const perNgo = { ...targetForm.perNgo };
    const share = Math.floor(short / ngos.length);
    let rem = short - share * ngos.length;
    ngos.forEach((n, i) => {
      const cur = Number(perNgo[n.id]) || 0;
      perNgo[n.id] = String(cur + share + (i === ngos.length - 1 ? rem : 0));
    });
    setTargetForm({ ...targetForm, perNgo });
  };

  const rebalanceEvenly = () => {
    const ngos = data?.ngos || [];
    const overall = Number(targetForm.overall) || 0;
    const perNgo = {};
    if (ngos.length > 0 && overall > 0) {
      const share = Math.floor(overall / ngos.length);
      const rem = overall - share * ngos.length;
      ngos.forEach((n, i) => { perNgo[n.id] = String(share + (i === ngos.length - 1 ? rem : 0)); });
    }
    setTargetForm({ overall: targetForm.overall, perNgo });
  };

  const saveTarget = async () => {
    const ngos = data?.ngos || [];
    const byNgo = {};
    const sum = ngos.reduce((s, n) => { const v = Number(targetForm.perNgo[n.id]) || 0; byNgo[n.id] = v; return s + v; }, 0);
    const overall = (Number(targetForm.overall) || 0) > 0 ? Number(targetForm.overall) : sum;
    setSavingTarget(true);
    try {
      await apiPut('/accounts/report-targets', { month, overall, byNgo });
      setSavedToast(true);
      setShowTargetForm(false);
      await load();
      setTimeout(() => setSavedToast(false), 2500);
    } catch (e) {
      setError(e.message || 'Failed to save target');
    } finally {
      setSavingTarget(false);
    }
  };

  // effective per-NGO targets = saved (from backend rows) unless editing
  const ngos = data?.ngos || [];
  const sourceTabs = (data?.sourceTabs && data.sourceTabs.length > 0) ? data.sourceTabs : ngos;
  const sourceOrder = data?.sourceOrder || [];
  const rows = data?.rows || [];
  const workDays = data?.workDays || null;

  // Monthly target form derived state (allocation vs the overall anchor)
  const overallAnchor = Number(targetForm.overall) || 0;
  const perNgoSum = ngos.reduce((s, n) => s + (Number(targetForm.perNgo[n.id]) || 0), 0);
  const shortfall = Math.max(0, overallAnchor - perNgoSum);
  const excess = Math.max(0, perNgoSum - overallAnchor);

  // target lookup: saved per-ngo (byNgoTargets) merged over rows
  const savedTargets = {};
  rows.forEach(r => { savedTargets[r.id] = r.monthlyTarget; });

  // grand totals
  const grandBySource = {};
  sourceOrder.forEach(s => {
    grandBySource[s] = ngos.reduce((sum, n) => sum + ((data?.byNgo?.[n.id]?.sources?.[s]) || 0), 0);
  });
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);
  const grandSourceTotal = rows.reduce((s, r) => s + (r.sourceTotal || 0), 0);
  const grandReceiptCount = rows.reduce((s, r) => s + (r.receiptCount || 0), 0);
  const totalTargets = rows.reduce((s, r) => s + (r.monthlyTarget > 0 ? r.monthlyTarget : 0), 0);
  const grandDiff = grandTotal - totalTargets;
  const totalAvgPerDay = workDays && workDays.workingDaysLeft > 0 ? Math.max(0, totalTargets - grandTotal) / workDays.workingDaysLeft : null;

  // Agent / Team collection (from /report-agent-team)
  const atcAgents = atc?.agents || [];
  const atcTeams = atc?.teams || [];
  const atcSlugs = atc?.ngos && atc.ngos.length > 0 ? atc.ngos.map(n => n.id) : (ngos.map(n => String(n.id).toLowerCase()).filter(id => ['bsct', 'aflf', 'mann'].includes(id)));
  const atcLabel = { bsct: 'BSCT', aflf: 'AFLF', mann: 'MANN' };
  const sumByNgo = (arr, n) => arr.reduce((s, a) => s + (a.byNgo?.[n] || 0), 0);

  // export CSV
  const exportCsv = async () => {
    if (locked) { const ok = await access.open(); if (!ok) return; setLocked(false); }
    const header = ['NGO', 'Receipts', 'Collection Total', ...sourceOrder.map(s => `Source: ${s}`), 'Source Total', 'Monthly Target', 'Diff (Total - Monthly)', 'Working Days Left', 'Avg / Day'];
    const body = rows.map(r => [
      r.name, r.receiptCount || 0, r.total,
      ...sourceOrder.map(s => (data?.byNgo?.[r.id]?.sources?.[s]) || 0),
      r.sourceTotal || 0,
      r.monthlyTarget > 0 ? r.monthlyTarget : '',
      r.monthlyTarget > 0 ? round2((r.total || 0) - r.monthlyTarget) : '',
      r.workingDaysLeft > 0 ? r.workingDaysLeft : '',
      r.monthlyTarget > 0 && r.workingDaysLeft > 0 ? round2(r.avgPerDay) : '',
    ]);
    const all = [header, ...body];
    all.push([], ['Total', grandReceiptCount, grandTotal, ...sourceOrder.map(() => ''), grandTotal, totalTargets, round2(grandDiff), workDays ? workDays.workingDaysLeft : '', totalAvgPerDay !== null ? round2(totalAvgPerDay) : '']);
    if (atc) {
      all.push([], ['Agent-wise Collection', ...atcSlugs.map(s => atcLabel[s] || s), 'Total', 'Receipts']);
      atcAgents.forEach(a => all.push([a.name, ...atcSlugs.map(s => a.byNgo?.[s] || 0), a.total, a.count]));
      if (atcTeams.length > 0) {
        all.push([], ['Team-wise Collection', 'Members', ...atcSlugs.map(s => atcLabel[s] || s), 'Total', 'Receipts']);
        all.push(['Grand Total', atcTeams.reduce((s, t) => s + t.members, 0), ...atcSlugs.map(s => sumByNgo(atcTeams, s)), atcTeams.reduce((s, t) => s + t.total, 0), atcTeams.reduce((s, t) => s + t.count, 0)]);
        atcTeams.forEach(t => all.push([t.team, t.members, ...atcSlugs.map(s => t.byNgo?.[s] || 0), t.total, t.count]));
      }
    }
    const csv = '\uFEFF' + all.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accounts-report-${(reportFrom && reportTo) ? reportFrom + '-' + reportTo : (reportDay || month)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => { window.print(); };

  return (
    <div style={{ maxWidth: '100%' }}>
      <style>{printStyle}</style>
      <style>{animStyle}</style>

      {/* Header + Toolbar */}
      <div className="no-print rp-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>Collection Report</h1>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>
            {reportFrom && reportTo ? rangeLabel(reportFrom, reportTo) : (reportDay ? dayLabel(reportDay) : monthLabel(month))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>From</span>
            <input type="date" value={reportFrom || ''} style={inputStyle}
              onChange={e => { const v = e.target.value || null; setReportFrom(v); if (v) { setReportDay(null); } }} />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>To</span>
            <input type="date" value={reportTo || ''} style={inputStyle}
              onChange={e => { const v = e.target.value || null; setReportTo(v); if (v) { setReportDay(null); } }} />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Day</span>
            <input type="date" value={reportDay || ''} style={inputStyle}
              onChange={e => { const v = e.target.value || null; setReportDay(v); if (v) { setMonth(v.slice(0, 7)); setReportFrom(null); setReportTo(null); } }} />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Month</span>
            <input type="month" value={month} style={inputStyle}
              onChange={e => { setMonth(e.target.value); setReportDay(null); setReportFrom(null); setReportTo(null); }} />
          </div>
          <button className="btn" onClick={() => load()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Refresh
          </button>
          {locked ? (
            <button className="btn" onClick={handleUnlock} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #fcd34d', color: '#92400e', background: '#fffbeb' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
              Unlock values
            </button>
          ) : (
            <button className="btn" onClick={handleLock} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #d1d5db', color: '#4b5563' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Lock values
            </button>
          )}
          <button className="btn btn-primary" onClick={openTargetForm} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Monthly Target
          </button>
        </div>
      </div>

      {savedToast && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: '#B9EFCE', color: '#1B7A3D', fontSize: 13, fontWeight: 600 }}>Target saved successfully.</div>
      )}

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: '#FBDBD6', color: '#B3392B', fontSize: 13 }}>{error}</div>
      )}

      {/* Monthly Target editor */}
      {showTargetForm && (
        <div className="card rp-card" style={{ marginBottom: 16, padding: 16, border: '2px solid var(--sage)' }}>
          <div className="card-head" style={{ padding: 0, border: 0, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Monthly Target — {monthLabel(month)}</h3>
            <button className="btn btn-sm" onClick={() => setShowTargetForm(false)}>Cancel</button>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>Overall Target (kept as-is)</div>
              <input type="number" value={targetForm.overall} onChange={e => onOverallChange(e.target.value)}
                placeholder="e.g. 900000" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 14, fontWeight: 600 }} />
            </div>
            <button className="btn btn-sm" onClick={rebalanceEvenly} title="Redistribute overall evenly across NGOs">Re-balance Evenly</button>
            {shortfall > 0 && (
              <button className="btn btn-sm" onClick={distributeShortfall} title="Spread the unallocated amount across all NGOs"
                style={{ background: 'var(--sage)', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Apply Recommendation
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            {ngos.map(n => (
              <div key={n.id} style={{ minWidth: 180 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>{n.name}</div>
                <input type="number" value={targetForm.perNgo[n.id] || ''}
                  onChange={e => onNgoTargetChange(n.id, e.target.value)}
                  placeholder="0" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 14, width: '100%' }} />
              </div>
            ))}
          </div>

          {/* Allocation status + recommendation */}
          {overallAnchor > 0 && (
            <div style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 600, background: shortfall > 0 || excess > 0 ? '#FEF3C7' : '#B9EFCE', color: shortfall > 0 || excess > 0 ? '#92400E' : '#1B7A3D', border: shortfall > 0 || excess > 0 ? '1px solid #FDE68A' : '1px solid #86EFAC' }}>
              {shortfall > 0 ? (
                <>
                  Allocated {currency(perNgoSum)} of {currency(overallAnchor)} · <strong>{currency(shortfall)} left</strong> to distribute.
                  <div style={{ fontWeight: 500, fontSize: 12, marginTop: 6, background: 'rgba(255,255,255,.6)', padding: '6px 8px', borderRadius: 6 }}>
                    Recommendation: add <strong>{currency(Math.floor(shortfall / Math.max(ngos.length, 1)))}</strong> to each NGO (≈ +{currency(Math.floor(shortfall / Math.max(ngos.length, 1)))} here &amp; there) so the total reaches {currency(overallAnchor)}. <button onClick={distributeShortfall} style={{ background: '#92400E', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', marginLeft: 6 }}>Apply</button>
                  </div>
                </>
              ) : excess > 0 ? (
                <>Allocated <strong>{currency(perNgoSum)}</strong> is <strong>{currency(excess)}</strong> more than the overall target {currency(overallAnchor)}. Lower a share or raise the overall.</>
              ) : (
                <>Allocated {currency(perNgoSum)} = overall target {currency(overallAnchor)} — fully distributed.</>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={saveTarget} disabled={savingTarget}>
              {savingTarget ? 'Saving...' : 'Save Target'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Overall stays fixed; set any NGO to a different share and the difference is shown below as a recommendation to spread it here &amp; there.</span>
          </div>
        </div>
      )}

      {/* Summary stat cards */}
      {loading ? (
        <div className="stats-grid" style={{ marginBottom: 20 }}><div style={{ gridColumn: '1 / -1', width: '100%' }}><StatCardSkeleton /></div></div>
      ) : (
        <div className="rp-card" style={{ marginBottom: 20 }}>
          <div className="stat-card" style={{ width: '100%', boxSizing: 'border-box', background: '#2563eb', border: 'none', position: 'relative', overflow: 'hidden', minHeight: 80, paddingBottom: 48 }}>
            <div className="stat-icon" style={{ background: 'rgba(255,255,255,.18)', color: '#fff', position: 'relative' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3a4 4 0 0 0 0-8H6"/></svg>
            </div>
            <div className="stat-info" style={{ color: '#fff', position: 'relative' }}>
              <div className="stat-num" style={{ color: '#fff' }}>{mask(currency(grandTotal))} <span style={{ fontSize: 13, fontWeight: 500, opacity: .85 }}>collected</span></div>
              <div className="stat-lbl" style={{ color: 'rgba(255,255,255,.9)' }}>{mask(grandReceiptCount.toLocaleString('en-IN'))} receipts · {reportFrom && reportTo ? rangeLabel(reportFrom, reportTo) : (reportDay ? dayLabel(reportDay) : monthLabel(month))}</div>
            </div>
            <TenorCrab />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
            {rows.map((r, i) => (
              <div className="stat-card" key={r.id} style={{ width: 280, maxWidth: '100%', boxSizing: 'border-box' }}>
                <div className="stat-icon" style={{ background: i % 2 ? '#E7F3EC' : '#EAF1FB', color: i % 2 ? '#1f6f3f' : '#2563eb' }}>
                  {['BSCT', 'MANN', 'AFLF'].includes(r.id) ? r.id.slice(0, 2) : r.name.slice(0, 1)}
                </div>
                <div className="stat-info">
                  <div className="stat-lbl" style={{ fontSize: 12 }}>{r.name}</div>
                  <div className="stat-num" style={{ fontSize: 20 }}>{mask(currency(r.total))}</div>
                  <div className="stat-sub">
                    {r.monthlyTarget > 0
                      ? <><span style={{ color: r.diff >= 0 ? '#1B7A3D' : '#B3392B', fontWeight: 700 }}>{mask((round2(r.diff) >= 0 ? '+' : '') + currency(round2(r.diff)))}</span> avg/day vs &nbsp;{mask(currency(r.monthlyTarget))} target</>
                      : '—'
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <>
          <div className="card rp-card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h3 style={{ margin: 0, fontSize: 14 }}>NGO-wise Target vs Collection</h3></div>
            <TableSkeleton cols={8} rows={4} />
          </div>
          <div className="card rp-card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h3 style={{ margin: 0, fontSize: 14 }}>Collection by Payment Source (NGO-wise)</h3></div>
            <TableSkeleton cols={5} rows={5} />
          </div>
        </>
      ) : (
        <>
          {/* Target & daily-average summary */}
          <div className="card rp-card" style={{ marginBottom: 16, overflow: 'hidden' }}>
            <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 14 }}>NGO-wise Target vs Collection</h3>
                <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>vs monthly target · {reportFrom && reportTo ? 'range' : (reportDay ? 'daily view' : 'monthly')}</span>
              </div>
              {workDays && (
                <span style={{ fontSize: 12, color: 'var(--ink-soft)', marginLeft: 'auto' }}>
                  <b style={{ color: 'var(--ink)' }}>Calendar Days:</b>&nbsp;{workDays.calendarDays}&nbsp;·&nbsp;<b style={{ color: 'var(--ink)' }}>Sundays:</b>&nbsp;{workDays.sundays}&nbsp;·&nbsp;<b style={{ color: 'var(--ink)' }}>Working Sundays:</b>&nbsp;{workDays.workingSundays}&nbsp;·&nbsp;<b style={{ color: 'var(--ink)' }}>Holidays:</b>&nbsp;{workDays.holidays}&nbsp;·&nbsp;<b style={{ color: 'var(--ink)' }}>Working Days Left:</b>&nbsp;{workDays.workingDaysLeft}
                </span>
              )}
            </div>
            <div className="table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', background: '#f9fafb' }}>
                    <th style={{ padding: '9px 12px' }}>NGO</th>
                    <th style={{ padding: '9px 12px' }}>Receipts</th>
                    <th style={{ padding: '9px 12px' }}>Monthly Target</th>
                    <th style={{ padding: '9px 12px' }}>Total Collected</th>
                    <th style={{ padding: '9px 12px' }}>Diff</th>
                    <th style={{ padding: '9px 12px' }}>Working Days Left</th>
                    <th style={{ padding: '9px 12px' }}>Avg / Day</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const hasTarget = r.monthlyTarget > 0;
                    const diffTotal = hasTarget ? round2((r.total || 0) - r.monthlyTarget) : null;
                    const diffColor = diffTotal !== null ? (diffTotal >= 0 ? '#1B7A3D' : '#B3392B') : null;
                    const canAvg = hasTarget && r.workingDaysLeft > 0;
                    return (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--line)', background: r.id === sourceTab ? '#F3FBF6' : 'transparent' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: '9px 12px' }}>{mask((r.receiptCount || 0).toLocaleString('en-IN'))}</td>
                        <td style={{ padding: '9px 12px' }}>{hasTarget ? mask(currency(r.monthlyTarget)) : '—'}</td>
                        <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(r.total))}</td>
                        <td style={{ padding: '9px 12px', fontWeight: 700, color: diffColor }}>{diffTotal !== null ? mask((diffTotal >= 0 ? '+' : '') + currency(diffTotal)) : '—'}</td>
                        <td style={{ padding: '9px 12px' }}>{r.workingDaysLeft > 0 ? mask(r.workingDaysLeft) : '—'}</td>
                        <td style={{ padding: '9px 12px' }}>{canAvg ? mask(currency(round2(r.avgPerDay))) : '—'}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ borderTop: '2px solid var(--sage)', fontWeight: 700, background: '#F6F8F7' }}>
                    <td style={{ padding: '9px 12px' }}>Total</td>
                    <td style={{ padding: '9px 12px' }}>{mask(grandReceiptCount.toLocaleString('en-IN'))}</td>
                    <td style={{ padding: '9px 12px' }}>{mask(currency(totalTargets))}</td>
                    <td style={{ padding: '9px 12px' }}>{mask(currency(grandTotal))}</td>
                    <td style={{ padding: '9px 12px', color: grandDiff >= 0 ? '#1B7A3D' : '#B3392B' }}>{mask((grandDiff >= 0 ? '+' : '') + currency(grandDiff))}</td>
                    <td style={{ padding: '9px 12px' }}>{workDays ? mask(workDays.workingDaysLeft) : '—'}</td>
                    <td style={{ padding: '9px 12px' }}>{totalAvgPerDay !== null ? mask(currency(round2(totalAvgPerDay))) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment Source / Team-wise tabs */}
          <div className="no-print rp-tabs" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, padding: 4, gap: 4 }}>
              <button
                onClick={() => setViewTab('source')}
                style={{
                  padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: viewTab === 'source' ? '#fff' : 'transparent', color: viewTab === 'source' ? '#1f6f3f' : '#6b7280',
                  boxShadow: viewTab === 'source' ? '0 1px 3px rgba(0,0,0,.12)' : 'none'
                }}
              >Collection by Payment Source</button>
              <button
                onClick={() => setViewTab('team')}
                style={{
                  padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                  background: viewTab === 'team' ? '#fff' : 'transparent', color: viewTab === 'team' ? '#1f6f3f' : '#6b7280',
                  boxShadow: viewTab === 'team' ? '0 1px 3px rgba(0,0,0,.12)' : 'none'
                }}
              >Team-wise Collection</button>
            </div>
          </div>

          {viewTab === 'source' && (
            <div className="card rp-card" style={{ marginBottom: 16 }}>
              <div className="card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 14, color: 'var(--ink)' }}>Collection by Payment Source (NGO-wise)</h3>
                <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[{ id: 'All', name: 'All' }, ...sourceTabs].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSourceTab(t.id)}
                      style={{
                        padding: '5px 14px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        border: '1px solid var(--line)', background: sourceTab === t.id ? 'var(--sage)' : '#fff',
                        color: sourceTab === t.id ? '#fff' : '#374151'
                      }}
                    >{t.name}</button>
                  ))}
                </div>
              </div>
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', background: '#f9fafb' }}>
                      <th style={{ padding: '9px 12px' }}>Source</th>
                      {(sourceTab === 'All' ? sourceTabs : sourceTabs.filter(n => n.id === sourceTab)).map(n => <th key={n.id} style={{ padding: '9px 12px' }}>{n.name}</th>)}
                      {sourceTab === 'All' && <th style={{ padding: '9px 12px' }}>Total</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sourceOrder.map(src => (
                      <tr key={src} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '9px 12px' }}><span className="pill pill-gray">{src}</span></td>
                        {(sourceTab === 'All' ? sourceTabs : sourceTabs.filter(n => n.id === sourceTab)).map(n => (
                          <td key={n.id} style={{ padding: '9px 12px' }}>{mask(currency(data?.byNgo?.[n.id]?.sources?.[src] || 0))}</td>
                        ))}
                        {sourceTab === 'All' && <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(grandBySource[src]))}</td>}
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--sage)', background: '#F6F8F7' }}>
                      <td style={{ padding: '9px 12px', fontWeight: 700 }}>Source Total (receipts)</td>
                      {(sourceTab === 'All' ? sourceTabs : sourceTabs.filter(n => n.id === sourceTab)).map(n => (
                        <td key={n.id} style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency((rows.find(r => r.id === n.id)?.sourceTotal) || 0))}</td>
                      ))}
                      {sourceTab === 'All' && <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(grandSourceTotal))}</td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {viewTab === 'team' && (
            <div className="card rp-card" style={{ marginBottom: 16 }}>
              <div className="card-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 14, color: 'var(--ink)' }}>Team-wise Collection</h3>
                <div className="no-print" style={{ display: 'inline-flex', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, padding: 4, gap: 4 }}>
                  <button
                    onClick={() => setAtcTab('agent')}
                    style={{
                      padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: atcTab === 'agent' ? '#fff' : 'transparent', color: atcTab === 'agent' ? '#1f6f3f' : '#6b7280',
                      boxShadow: atcTab === 'agent' ? '0 1px 3px rgba(0,0,0,.12)' : 'none'
                    }}
                  >Agent-wise (FRO)</button>
                  <button
                    onClick={() => setAtcTab('team')}
                    style={{
                      padding: '7px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                      background: atcTab === 'team' ? '#fff' : 'transparent', color: atcTab === 'team' ? '#1f6f3f' : '#6b7280',
                      boxShadow: atcTab === 'team' ? '0 1px 3px rgba(0,0,0,.12)' : 'none'
                    }}
                  >Team-wise</button>
                </div>
              </div>

              {!atc ? (
                <div className="empty" style={{ padding: 48, textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
                  Agent / team collection unavailable. The report needs the <code>workers.team</code> column and the <code>/accounts/report-agent-team</code> endpoint.
                </div>
              ) : (
                <>
                  {/* Team stat cards */}
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
                    {atcTeams.map(t => {
                      const st = TEAM_STYLE[t.team] || TEAM_STYLE['No Team'];
                      return (
                        <div key={t.team} className="stat-card" style={{ width: 200, maxWidth: '100%', boxSizing: 'border-box' }}>
                          <div className="stat-icon" style={{ background: st.bg, color: st.fg }}>{t.team === 'No Team' ? '—' : t.team.slice(-1)}</div>
                          <div className="stat-info">
                            <div className="stat-lbl" style={{ fontSize: 12 }}>{t.team}</div>
                            <div className="stat-num" style={{ fontSize: 18 }}>{mask(currency(t.total))}</div>
                            <div className="stat-sub">{mask(t.members)} members · {mask(t.count.toLocaleString('en-IN'))} receipts</div>
                            <div className="stat-sub" style={{ color: '#1f6f3f', fontWeight: 700 }}>Today: {mask(currency(t.todayTotal || 0))} · {mask((t.todayCount || 0).toLocaleString('en-IN'))} rcts</div>
                          </div>
                        </div>
                      );
                    })}
                    {atcTeams.length === 0 && <div className="empty" style={{ color: 'var(--ink-soft)', fontSize: 13 }}>No teams yet — assign FRO workers to UFS1–UFS4 in HR &gt; Workers.</div>}
                  </div>

                  <div className="table-wrap" style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', fontSize: 11, letterSpacing: '.04em', textTransform: 'uppercase', color: '#6b7280', background: '#f9fafb' }}>
                          <th style={{ padding: '9px 12px' }}>#</th>
                          <th style={{ padding: '9px 12px' }}>{atcTab === 'agent' ? 'Agent' : 'Team'}</th>
                          {atcTab === 'agent' && <th style={{ padding: '9px 12px' }}>Team</th>}
                          {atcTab === 'team' && <th style={{ padding: '9px 12px' }}>Members</th>}
                          {atcSlugs.map(s => <th key={s} style={{ padding: '9px 12px' }}>{atcLabel[s] || String(s).toUpperCase()}</th>)}
                          <th style={{ padding: '9px 12px', color: '#1f6f3f' }}>Today</th>
                          <th style={{ padding: '9px 12px' }}>Total</th>
                          <th style={{ padding: '9px 12px' }}>Receipts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {atcTab === 'agent' ? (
                          <>
                            {atcAgents.map((a, i) => (
                              <tr key={a.id || a.category || 'unassigned'} style={{ borderTop: '1px solid var(--line)', background: a.id == null ? '#F9FAFB' : 'transparent' }}>
                                <td style={{ padding: '9px 12px', color: '#6b7280' }}>{i + 1}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 600 }}>
                                  {a.name}
                                  {a.id == null && !a.category && <span style={{ color: '#9ca3af', fontWeight: 400 }}> · unattributed receipts</span>}
                                  {a.category && <span style={{ color: '#9ca3af', fontWeight: 400 }}> · category</span>}
                                </td>
                                <td style={{ padding: '9px 12px' }}>
                                  {a.team ? <span className="pill" style={{ background: (TEAM_STYLE[a.team] || TEAM_STYLE['No Team']).bg, color: (TEAM_STYLE[a.team] || TEAM_STYLE['No Team']).fg, fontWeight: 600 }}>{a.team}</span> : <span style={{ color: '#9ca3af' }}>—</span>}
                                </td>
                                {atcSlugs.map(s => <td key={s} style={{ padding: '9px 12px' }}>{mask(currency(a.byNgo?.[s] || 0))}</td>)}
                                <td style={{ padding: '9px 12px', fontWeight: 600, color: '#1f6f3f' }}>{mask(currency(a.todayTotal || 0))}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(a.total))}</td>
                                <td style={{ padding: '9px 12px' }}>{mask((a.count || 0).toLocaleString('en-IN'))}</td>
                              </tr>
                            ))}
                            {atcAgents.length > 0 && (
                              <tr style={{ borderTop: '2px solid var(--sage)', background: '#F6F8F7' }}>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>Total</td>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{atcAgents.length} agents</td>
                                <td style={{ padding: '9px 12px' }}></td>
                                {atcSlugs.map(s => <td key={s} style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(sumByNgo(atcAgents, s)))}</td>)}
                                <td style={{ padding: '9px 12px', fontWeight: 700, color: '#1f6f3f' }}>{mask(currency(atcAgents.reduce((s, a) => s + (a.todayTotal || 0), 0)))}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(atcAgents.reduce((s, a) => s + a.total, 0)))}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(atcAgents.reduce((s, a) => s + (a.count || 0), 0).toLocaleString('en-IN'))}</td>
                              </tr>
                            )}
                          </>
                        ) : (
                          <>
                            {atcTeams.map((t, i) => {
                              const st = TEAM_STYLE[t.team] || TEAM_STYLE['No Team'];
                              return (
                                <tr key={t.team} style={{ borderTop: '1px solid var(--line)', background: t.team === 'No Team' ? '#F9FAFB' : 'transparent' }}>
                                  <td style={{ padding: '9px 12px', color: '#6b7280' }}>{i + 1}</td>
                                  <td style={{ padding: '9px 12px', fontWeight: 600 }}><span className="pill" style={{ background: st.bg, color: st.fg, fontWeight: 700 }}>{t.team}</span></td>
                                  <td style={{ padding: '9px 12px' }}>{mask(t.members)}</td>
                                  {atcSlugs.map(s => <td key={s} style={{ padding: '9px 12px' }}>{mask(currency(t.byNgo?.[s] || 0))}</td>)}
                                  <td style={{ padding: '9px 12px', fontWeight: 600, color: '#1f6f3f' }}>{mask(currency(t.todayTotal || 0))}</td>
                                  <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(t.total))}</td>
                                  <td style={{ padding: '9px 12px' }}>{mask((t.count || 0).toLocaleString('en-IN'))}</td>
                                </tr>
                              );
                            })}
                            {atcTeams.length > 0 && (
                              <tr style={{ borderTop: '2px solid var(--sage)', background: '#F6F8F7' }}>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>Total</td>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{atcTeams.reduce((s, t) => s + t.members, 0)} members</td>
                                <td style={{ padding: '9px 12px' }}></td>
                                {atcSlugs.map(s => <td key={s} style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(sumByNgo(atcTeams, s)))}</td>)}
                                <td style={{ padding: '9px 12px', fontWeight: 700, color: '#1f6f3f' }}>{mask(currency(atcTeams.reduce((s, t) => s + (t.todayTotal || 0), 0)))}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(currency(atcTeams.reduce((s, t) => s + t.total, 0)))}</td>
                                <td style={{ padding: '9px 12px', fontWeight: 700 }}>{mask(atcTeams.reduce((s, t) => s + (t.count || 0), 0).toLocaleString('en-IN'))}</td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={exportCsv} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export CSV
            </button>
            <button className="btn" onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Print
            </button>
          </div>
        </>
      )}

      {access.modal}
    </div>
  );
}
