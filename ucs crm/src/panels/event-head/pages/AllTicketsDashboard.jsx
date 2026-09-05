import { useState, useEffect, useCallback } from 'react';
import TicketGate from '../../../components/TicketGate';
import TechnicalTickets from '../../../components/TechnicalTickets';
import { getUnifiedDevTickets } from '../../dev-panel/api/tickets';

const AUTO_REFRESH_MS = 30000;
const SLA_TARGET_HOURS = 24;

const fmtDuration = (mins) => {
  if (!isFinite(mins) || mins < 0) return '—';
  if (mins < 60) return Math.round(mins) + ' min';
  const h = mins / 60;
  if (h < 24) return Math.round(h * 10) / 10 + ' hrs';
  return Math.round((h / 24) * 10) / 10 + ' days';
};

const fmtPct = (v) => (isFinite(v) ? (Math.round(v * 10) / 10) + '%' : '—');
const fmtName = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
const initials = (name) => String(name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const techNameOf = (t) => (t.assigned_worker && t.assigned_worker.name) || (typeof t.assigned_to === 'string' ? t.assigned_to : null) || null;

const AVATAR_COLORS = ['#4f46e5', '#0284c7', '#d97706', '#059669', '#db2777', '#7c3aed', '#0e7490', '#ea580c'];
const avatarColor = (name) => {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

const slaTone = (v) => (v >= 90 ? { fg: '#047857', color: '#22c55e' } : v >= 80 ? { fg: '#b45309', color: '#f59e0b' } : { fg: '#b91c1c', color: '#ef4444' });

function Card({ children, style }) {
  return <div className="card" style={{ borderRadius: 12, background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(71,85,105,.05)', ...style }}>{children}</div>;
}

function Kpi({ icon, iconBg, label, value, caption, barColor }) {
  return (
    <Card style={{ padding: '16px 18px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ width: 40, height: 40, borderRadius: 10, background: iconBg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 800, flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#64748b' }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', marginTop: 2 }}>{value}</div>
        <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>{caption}</div>
      </div>
    </Card>
  );
}

export default function AllTicketsDashboard() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const data = await getUnifiedDevTickets();
      setTickets((data || []).filter(t => t.category === 'technical'));
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load all tickets:', err);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const techMap = new Map();
  const unassigned = { name: 'Unassigned', assigned: 0, resolved: 0, open: 0, closed: 0, tatSum: 0, tatN: 0, within: 0 };
  const catMap = new Map();
  let totalResolved = 0;
  let totalWithin = 0;

  for (const t of tickets || []) {
    const name = techNameOf(t);
    const slot = name ? (techMap.get(name) || {
      name, assigned: 0, resolved: 0, open: 0, closed: 0, tatSum: 0, tatN: 0, within: 0,
    }) : unassigned;
    slot.assigned += 1;
    if ((t.status === 'resolved' || t.status === 'closed') && t.resolved_at && t.created_at) {
      slot.resolved += 1;
      totalResolved += 1;
      const tat = (new Date(t.resolved_at) - new Date(t.created_at)) / 60000;
      slot.tatSum += tat;
      slot.tatN += 1;
      if (tat <= SLA_TARGET_HOURS * 60) { slot.within += 1; totalWithin += 1; }
    }
    if (t.status === 'open' || t.status === 'in_progress' || t.status === 'under_review') slot.open += 1;
    if (t.status === 'closed') slot.closed += 1;
    if (name) techMap.set(name, slot);

    const cat = catMap.get(t.category) || { key: t.category || 'other', assigned: 0, resolved: 0, tatSum: 0, tatN: 0, within: 0, bestName: '', bestWithin: 0 };
    cat.assigned += 1;
    if ((t.status === 'resolved' || t.status === 'closed') && t.resolved_at && t.created_at) {
      cat.resolved += 1;
      const tat = (new Date(t.resolved_at) - new Date(t.created_at)) / 60000;
      cat.tatSum += tat;
      cat.tatN += 1;
      if (tat <= SLA_TARGET_HOURS * 60) cat.within += 1;
    }
    if (name && slot.resolved >= cat.bestWithin) { cat.bestName = name; cat.bestWithin = slot.resolved; }
    catMap.set(cat.key, cat);
  }

  const techRows = [...techMap.values()]
    .map(tech => ({
      ...tech,
      fcr: tech.assigned ? (tech.resolved / tech.assigned) * 100 : 0,
      avgTat: tech.tatN ? tech.tatSum / tech.tatN : null,
      sla: tech.resolved ? (tech.within / tech.resolved) * 100 : 0,
    }))
    .filter(t => t.resolved > 0 || t.open > 0)
    .sort((a, b) => b.resolved - a.resolved || b.sla - a.sla);

  const handled = tickets.length;
  const openTotal = (tickets || []).filter(t => t.status === 'open' || t.status === 'in_progress' || t.status === 'under_review').length;
  const slaOverall = totalResolved ? (totalWithin / totalResolved) * 100 : 0;
  const fcrOverall = handled ? (totalResolved / handled) * 100 : 0;
  const top = techRows[0] || null;

  const categories = [...catMap.values()]
    .map(c => ({
      ...c,
      avgTat: c.tatN ? c.tatSum / c.tatN : null,
      sla: c.resolved ? (c.within / c.resolved) * 100 : 0,
    }))
    .sort((a, b) => b.resolved - a.resolved);

  const exportCSV = () => {
    const head = 'Rank,Technician,Tickets Handled,Resolved,Open,FCR (%),Avg TAT,SLA (%)';
    const lines = techRows.map((r, i) => [
      i + 1, '"' + r.name + '"', r.assigned, r.resolved, r.open,
      fmtPct(r.fcr), fmtDuration(r.avgTat), fmtPct(r.sla),
    ].join(','));
    const csv = [head, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all-tickets-technician-matrix.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const btn = { padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#334155', cursor: 'pointer', fontFamily: 'inherit' };
  const btnPrimary = { ...btn, background: '#2563eb', borderColor: '#2563eb', color: '#fff' };

  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', fontWeight: 700, background: '#f8fafc', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' };
  const td = { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 12.5 };

  return (
    <TicketGate title="All Tickets" lead="This section is private. Enter the authorised username and password to view it.">
      {({ lock }) => (
        <div>
          {/* Header */}
          <Card style={{ padding: '16px 18px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#2563eb' }}>Support Overview</div>
              <h3 style={{ fontSize: 17, fontWeight: 800, margin: '3px 0 0', color: '#1e293b' }}>All Tickets</h3>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>Technician performance, resolution time and SLA compliance for all panels</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: refreshing ? '#dbeafe' : '#dcfce7', color: refreshing ? '#2563eb' : '#15803d' }}>
                {refreshing ? 'Refreshing…' : 'Live'} {lastUpdated ? '· ' + lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              <button onClick={exportCSV} style={btnPrimary}>Export CSV</button>
              <button onClick={lock} style={btn}>Lock</button>
            </div>
          </Card>

          {loading && techRows.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading analytics…</div>
          ) : (
            <>
              {/* KPI strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14, marginBottom: 16 }}>
                <Kpi icon="%" iconBg="#059669" label="SLA Compliance" value={fmtPct(slaOverall)}
                  caption={totalResolved ? totalResolved + ' resolved · ' + totalWithin + ' within ' + SLA_TARGET_HOURS + 'h' : 'No resolved tickets yet'} />
                <Kpi icon="✓" iconBg="#2563eb" label="Resolved Tickets" value={totalResolved}
                  caption={handled ? 'Out of ' + handled + ' tickets handled' : 'No tickets yet'} />
                <Kpi icon="●" iconBg="#d97706" label="Open Tickets" value={openTotal}
                  caption={handled ? 'Still being worked on' : 'No tickets yet'} />
                <Kpi icon={(top ? initials(top.name) : '—').slice(0, 2)} iconBg="#7c3aed" label="Top Performer" value={top ? top.name : '—'}
                  caption={top ? top.resolved + ' resolved · ' + fmtPct(top.sla) + ' SLA' : 'Waiting for data'} />
              </div>

              {/* Technician matrix */}
              <Card style={{ marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#1e293b' }}>Technician Performance</h4>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Ranked by resolved tickets, resolution speed and SLA</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#334155', background: '#f1f5f9', padding: '4px 10px', borderRadius: 999 }}>{techRows.length} technicians</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>Rank</th>
                        <th style={th}>Technician</th>
                        <th style={th}>Handled</th>
                        <th style={th}>Resolved</th>
                        <th style={th}>Open</th>
                        <th style={th}>FCR</th>
                        <th style={th}>Avg Time</th>
                        <th style={th}>SLA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(techRows.length ? techRows : [unassigned]).map((r, i) => {
                        const tone = slaTone(r.sla);
                        const rankBg = i === 0 ? '#fde68a' : i === 1 ? '#e2e8f0' : '#f1f5f9';
                        const rankFg = i === 0 ? '#92400e' : '#475569';
                        return (
                          <tr key={r.name}>
                            <td style={td}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 28, height: 22, borderRadius: 6, background: rankBg, color: rankFg, fontSize: 11, fontWeight: 800 }}>{i + 1}</span>
                            </td>
                            <td style={td}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ width: 30, height: 30, borderRadius: '50%', background: avatarColor(r.name) + '1f', color: avatarColor(r.name), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{initials(r.name)}</span>
                                <span style={{ fontWeight: 700, color: '#1e293b' }}>{r.name}</span>
                              </div>
                            </td>
                            <td style={{ ...td, fontWeight: 600 }}>{r.assigned || 0}</td>
                            <td style={td}>{r.resolved || 0}</td>
                            <td style={td}>{r.open || 0}</td>
                            <td style={{ ...td, fontWeight: 700, color: '#2563eb' }}>{fmtPct(r.fcr)}</td>
                            <td style={td}>{fmtDuration(r.avgTat)}</td>
                            <td style={td}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 50, height: 5, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                                  <div style={{ width: Math.max(2, Math.min(100, r.sla || 0)) + '%', height: '100%', background: tone.color, borderRadius: 999 }} />
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 800, color: tone.fg }}>{fmtPct(r.sla)}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Category split */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 16 }}>
                <Card style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#1e293b' }}>Resolution Speed by Category</h4>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Average time to resolve vs the {SLA_TARGET_HOURS}h SLA target</div>
                  </div>
                  <div style={{ padding: '4px 18px 10px' }}>
                    {categories.map(c => {
                      const tone = slaTone(c.sla);
                      return (
                        <div key={c.key} style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e293b' }}>{fmtName(c.key)} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({c.assigned})</span></span>
                            <span style={{ fontSize: 12.5, fontWeight: 800, color: tone.fg }}>{fmtDuration(c.avgTat)}</span>
                          </div>
                          <div style={{ height: 7, background: '#e2e8f0', borderRadius: 999, marginTop: 7, overflow: 'hidden' }}>
                            <div style={{ width: Math.max(2, Math.min(100, c.sla || 0)) + '%', height: '100%', background: tone.color, borderRadius: 999 }} />
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>{c.resolved} resolved · {fmtPct(c.sla)} within SLA · Best: {c.bestName || '—'}</div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>
            </>
          )}

          {/* Existing all-tickets table */}
          <Card style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: '#1e293b' }}>All Tickets</h4>
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>Full list of technical tickets raised across all panels</div>
            </div>
            <TechnicalTickets panel="event_head" viewOnly canRaise={false} category="technical" />
          </Card>
        </div>
      )}
    </TicketGate>
  );
}