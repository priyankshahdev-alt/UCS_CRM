import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSim } from './store';
import { Icon } from './components';
import { toast } from './Toast';
import { fetchReplacements } from './api';
import { effectiveStatus, dayClass, formatDate, pillForStatus } from './helpers';
import './dashboard.css';

function Donut({ segments, total }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const sum = segments.reduce((s, x) => s + x.value, 0) || 0;
  let offset = 0;
  return (
    <div className="donut">
      <svg width="132" height="132" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e8edf5" strokeWidth="15" />
        <g transform="rotate(-90 60 60)">
          {segments.map((s) => {
            const len = sum > 0 ? (s.value / sum) * c : 0;
            const seg = (
              <circle
                key={s.label}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="15"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return seg;
          })}
        </g>
      </svg>
      <div className="donut-center">
        <div className="n">{total}</div>
        <div className="l">SIMs</div>
      </div>
    </div>
  );
}

function MobileSummaryModal({ open, mobileType, cardType, records, onClose }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const SIM_FIELDS = Array.from({ length: 20 }, (_, i) => `sim_${i + 1}`);
  function countSims(c) { return SIM_FIELDS.filter((f) => c[f] && String(c[f]).trim()).length; }

  if (!open) return null;

  const isTotal = cardType === 'total';
  const totalCount = isTotal ? records.reduce((sum, c) => sum + countSims(c), 0) : records.length;
  const teamMap = {};
  if (isTotal) {
    records.forEach((c) => { const t = c.team || 'Unassigned'; if (mobileType === 'Nokia' && t === 'HR') return; teamMap[t] = (teamMap[t] || 0) + countSims(c); });
  } else {
    records.forEach((c) => { const t = c.team || 'Unassigned'; if (mobileType === 'Nokia' && t === 'HR') return; teamMap[t] = (teamMap[t] || 0) + 1; });
  }
  const teamRows = Object.entries(teamMap).sort((a, b) => b[1] - a[1]);

  const cardMeta = {
    total: { title: `${mobileType} Mobile Summary`, sub: `${totalCount} ${mobileType} SIMs`, label: 'All SIM Cards', sublabel: 'All registered SIMs' },
    active: { title: `${mobileType} \u2014 Active SIM Cards`, sub: `Currently active ${mobileType.toLowerCase()} records`, label: 'Active SIM Cards', sublabel: 'Currently active' },
    expiring: { title: `${mobileType} \u2014 Expiring Soon`, sub: `Expiring within 28 days`, label: 'Expiring Soon', sublabel: 'Within 28 days' },
    expired: { title: `${mobileType} \u2014 Expired SIM Cards`, sub: `Past expiry date`, label: 'Expired SIM Cards', sublabel: 'Past expiry date' },
    inactive: { title: `${mobileType} \u2014 Inactive`, sub: `No longer in use`, label: 'Inactive', sublabel: 'No longer in use' },
  };
  const meta = cardMeta[cardType] || cardMeta.total;

  const filtered = isTotal ? records : records.filter((c) => {
    if (cardType === 'active') return c._status === 'Active' || c._status === 'Expiring Soon';
    if (cardType === 'expiring') return c._status === 'Expiring Soon';
    if (cardType === 'expired') return c._status === 'Expired';
    if (cardType === 'inactive') return (c.status || 'Active') === 'Inactive';
    return true;
  });

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{meta.title}</h3>
            <span style={{ fontSize: 12, color: 'var(--sim-ink-soft)' }}>{meta.sub}</span>
          </div>
          <button className="modal-x" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {isTotal ? (
            <>
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sim-ink-soft)', marginBottom: 2 }}>{meta.label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--sim-ink)', lineHeight: 1.1 }}>{totalCount}</div>
                <div style={{ fontSize: 11, color: 'var(--sim-ink-soft)' }}>{meta.sublabel}</div>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sim-ink-soft)' }}>Total:</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--sim-ink)' }}>{totalCount}</div>
              </div>
              {totalCount === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--sim-ink-soft)', fontSize: 13 }}>No records found.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="dash-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th>Mobile ID</th>
                        <th>Device</th>
                        <th>Team</th>
                        <th>SIM 1</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c) => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 600 }}>{c.mobile_id}</td>
                          <td>{c.device || '\u2014'}</td>
                          <td>{c.team || '\u2014'}</td>
                          <td>{c.sim_1 || '\u2014'}</td>
                          <td><span className={`pill ${pillForStatus(c._status)}`}>{c._status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UfsDistributionModal({ open, category, records, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !category) return null;

  const SIM_FIELDS = Array.from({ length: 20 }, (_, i) => `sim_${i + 1}`);
  function countSims(c) { return SIM_FIELDS.filter((f) => c[f] && String(c[f]).trim()).length; }

  const ngoMap = {};
  records.forEach((c) => {
    if ((c.team || '').trim().toUpperCase() !== category.toUpperCase()) return;
    const ngo = (c.ngo || '').trim() || 'Unassigned';
    ngoMap[ngo] = (ngoMap[ngo] || 0) + countSims(c);
  });
  const ngoRows = Object.entries(ngoMap).sort((a, b) => b[1] - a[1]);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" ref={ref} onClick={(e) => e.stopPropagation()} style={{ background: '#ffffff' }}>
        <div className="modal-head">
          <div>
            <h3>{category}</h3>
            <span style={{ fontSize: 12, color: 'var(--sim-ink-soft)' }}>SIM Distribution by NGO</span>
          </div>
          <button className="modal-x" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
            {ngoRows.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--sim-ink-soft)' }}>No SIMs found for {category}.</div>
            ) : (
              ngoRows.map(([ngo, count]) => (
                <div key={ngo} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '18px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sim-ink)', marginBottom: 6 }}>{ngo}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#2563eb', lineHeight: 1 }}>{count}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ onAdd, onView, onEdit, onReplace }) {
  const { cards, loading, inventory, refreshInventory } = useSim();
  const [activity, setActivity] = useState([]);
  const [modal, setModal] = useState(null);
  const [ufsModal, setUfsModal] = useState(null);
  const [androidUfsModal, setAndroidUfsModal] = useState(null);
  const [expiryAlertDismissed, setExpiryAlertDismissed] = useState(false);

  const SIM_FIELDS = Array.from({ length: 20 }, (_, i) => `sim_${i + 1}`);
  function countSims(c) { return SIM_FIELDS.filter((f) => c[f] && String(c[f]).trim()).length; }

  const data = useMemo(() => {
    const enriched = cards.map((c) => ({ ...c, _status: effectiveStatus(c) }));
    const total = enriched.reduce((sum, c) => sum + countSims(c), 0);
    const active = enriched.filter((c) => c._status === 'Active').reduce((sum, c) => sum + countSims(c), 0) + enriched.filter((c) => c._status === 'Expiring Soon').reduce((sum, c) => sum + countSims(c), 0);
    const expiring = enriched.filter((c) => c._status === 'Expiring Soon').reduce((sum, c) => sum + countSims(c), 0);
    const expired = enriched.filter((c) => c._status === 'Expired').reduce((sum, c) => sum + countSims(c), 0);
    const replaced = enriched.filter((c) => c._status === 'Replaced').reduce((sum, c) => sum + countSims(c), 0);
    const inactive = enriched.filter((c) => (c.status || 'Active') === 'Inactive').reduce((sum, c) => sum + countSims(c), 0);
    const noSim = enriched.filter((c) => countSims(c) === 0).length;

    const buckets = {
      expired,
      exp7: enriched.filter((c) => { const d = c.days_left; return c._status === 'Expiring Soon' && d !== null && d <= 7; }).length,
      exp30: enriched.filter((c) => { const d = c.days_left; return c._status === 'Expiring Soon' && d !== null && d > 7 && d <= 28; }).length,
      ok30: enriched.filter((c) => { const d = c.days_left; return d !== null && d > 28; }).length,
    };

    const urgent = enriched
      .filter((c) => c._status === 'Expiring Soon' || c._status === 'Expired')
      .sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999))
      .slice(0, 8);

    return { enriched, total, noSim, active, expiring, expired, replaced, inactive, buckets, urgent };
  }, [cards]);

  const inv = useMemo(() => {
    const available = inventory.filter((i) => i.status === 'Available').length;
    const assigned = inventory.filter((i) => i.status === 'Assigned').length;
    const expired = inventory.filter((i) => i.status === 'Expired').length;
    const lostDamaged = inventory.filter((i) => i.status === 'Lost' || i.status === 'Damaged').length;
    return { total: inventory.length, available, assigned, expired, lostDamaged };
  }, [inventory]);

  const recentActivity = useMemo(() => activity.slice(0, 5).map((r) => ({
    id: `${r.id}`,
    icon: 'replace',
    title: 'SIM replaced',
    detail: [
      r.old_sim ? `Old: ${r.old_sim}` : '',
      r.new_sim ? `New: ${r.new_sim}` : '',
    ].filter(Boolean).join(' \u00b7 '),
    meta: [r.device, r.mobile_id, formatDate(r.replacement_date)].filter(Boolean).join('  \u00b7  '),
  })), [activity]);

  const notifiedRef = useRef(null);
  useEffect(() => {
    if (loading) return;
    if (data.expiring > 0 && notifiedRef.current !== data.expiring) {
      notifiedRef.current = data.expiring;
      toast(`${data.expiring} SIM card${data.expiring > 1 ? 's' : ''} expiring within 30 days`, 'info', 5000);
    }
  }, [data.expiring, loading]);

  useEffect(() => {
    refreshInventory();
    fetchReplacements()
      .then((list) => setActivity(Array.isArray(list) ? list : []))
      .catch(() => setActivity([]));
    /* eslint-disable-next-line */
  }, []);

  const nokiaCards = data.enriched.filter((c) => (c.mobile_id || '').toLowerCase().startsWith('ufrs'));
  const androidCards = data.enriched.filter((c) => (c.mobile_id || '').toLowerCase().startsWith('android'));

  if (loading && cards.length === 0) {
    return <div className="empty-state"><div className="big">Loading SIM data...</div></div>;
  }

  const summary = [
    { label: 'All SIM Cards', val: data.total, sub: 'All registered SIMs', icon: 'simcard', ic: { bg: 'var(--sim-blue-soft)', color: 'var(--sim-blue)' }, bar: '#2563eb' },
    { label: 'Active SIM Cards', val: data.active, sub: 'Currently active', icon: 'sim', ic: { bg: '#f0fdf4', color: '#16a34a' }, bar: '#16a34a' },
    { label: 'Expiring Soon', val: data.expiring, sub: 'Within 28 days', icon: 'clock', ic: { bg: 'var(--sim-amber-soft)', color: 'var(--sim-amber)' }, bar: '#d97706' },
    { label: 'Inactive', val: data.inactive, sub: 'No longer in use', icon: 'mobile', ic: { bg: '#f1f5f9', color: '#64748b' }, bar: '#94a3b8' },
  ];

  const statusSegments = [
    { label: 'Active', value: data.active, color: '#16a34a' },
    { label: 'Expiring Soon', value: data.expiring, color: '#d97706' },
    { label: 'Expired', value: data.expired, color: '#dc2626' },
  ];

  const invItems = [
    { label: 'Available', val: inv.available, color: '#16a34a' },
    { label: 'Assigned', val: inv.assigned, color: '#2563eb' },
    { label: 'Expired', val: inv.expired, color: '#dc2626' },
    { label: 'Lost / Damaged', val: inv.lostDamaged, color: '#d97706' },
  ];

  const statusSumAll = statusSegments.reduce((s, x) => s + x.value, 0) || 1;
  const expiryItems = [
    { label: 'Expired', val: data.buckets.expired, color: '#dc2626' },
    { label: 'Expiring in 7 Days', val: data.buckets.exp7, color: '#d97706' },
    { label: 'Expiring in 30 Days', val: data.buckets.exp30, color: '#f59e0b' },
    { label: 'Active for 30+ Days', val: data.buckets.ok30, color: '#16a34a' },
  ];
  const expiryMax = Math.max(...expiryItems.map((i) => i.val), 1);

  const quickActions = [
    { label: 'All SIM Cards', path: '/sim/inventory', icon: 'simcard', color: '#2563eb', bg: '#eff6ff' },
  ];

  const statusCardMap = {
    'Active SIM Cards': 'active',
    'Expiring Soon': 'expiring',
    'Expired': 'expired',
    'Inactive': 'inactive',
  };

  function openModal(deviceType, cardLabel) {
    const ct = cardLabel === 'All SIM Cards' ? 'total' : (statusCardMap[cardLabel] || 'total');
    setModal({ deviceType, cardLabel, cardType: ct });
  }

  function buildSummaryCards(items, deviceType, totalVal) {
    return items.map((it) => {
      const cardType = it.key === 'total' ? 'total' : (statusCardMap[it.label] || 'total');
      return (
        <div
          className="dash-kpi compact"
          key={it.label}
          onClick={() => openModal(deviceType, it.label)}
          style={{ cursor: 'pointer' }}
        >
          <span className="kpi-accent" style={{ background: it.bar }} />
          <div className="kpi-top">
            <div className="kpi-ic" style={it.ic}><Icon name={it.icon} size={18} /></div>
            <div className="kpi-label">{it.label}</div>
          </div>
          <div className="kpi-num">{it.val}</div>
          <div className="kpi-sub">{it.sub}</div>
          <div className="kpi-foot"><span style={{ width: `${Math.min(100, totalVal ? (it.val / totalVal) * 100 : 0)}%`, background: it.bar }} /></div>
        </div>
      );
    });
  }

  return (
    <div className="dash">
      {data.total === 0 && (
        <div className="dash-banner">
          <div>
            <div className="b-txt">No SIM Cards Found</div>
            <div className="b-sub">Add your first SIM card to start tracking devices and expiry dates.</div>
          </div>
          <button className="sim-btn primary" onClick={onAdd}>+ Add SIM Card</button>
        </div>
      )}

      <div className="dash-kpi-grid">
        {summary.map((s) => (
          <div className="dash-kpi" key={s.label}>
            <span className="kpi-accent" style={{ background: s.bar }} />
            <div className="kpi-top">
              <div className="kpi-ic" style={s.ic}><Icon name={s.icon} size={18} /></div>
              <div className="kpi-label">{s.label}</div>
            </div>
            <div className="kpi-num">{s.val}</div>
            <div className="kpi-sub">{s.sub}</div>
            <div className="kpi-foot"><span style={{ width: `${Math.min(100, data.total ? (s.val / data.total) * 100 : 0)}%`, background: s.bar }} /></div>
          </div>
        ))}
      </div>

      {!expiryAlertDismissed && (() => {
        const soon = data.expiring + data.buckets.expired;
        if (soon <= 0) return null;
        const urgent = data.urgent || [];
        return (
          <div className="dash-banner" style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)', borderColor: '#fcd34d' }}>
            <div>
              <div className="b-txt">⚠ {soon} SIM card{soon > 1 ? 's' : ''} expiring soon</div>
              <div className="b-sub">{urgent.length > 0 ? `Nearest: ${urgent.map((c) => c.mobile_id).join(', ')}` : 'Check the table for details.'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="sim-btn" style={{ padding: '7px 12px', fontSize: 13 }} onClick={() => setExpiryAlertDismissed(true)}>Dismiss</button>
            </div>
          </div>
        );
      })()}

      <div className="dash-row">
        <section className="dash-panel">
          <div className="panel-head"><h3>Nokia Mobile Summary</h3><span className="ln">{nokiaCards.reduce((s, c) => s + countSims(c), 0)} Nokia SIMs</span></div>
          {(() => {
            const teamMap = {};
            nokiaCards.forEach((c) => { const t = c.team || 'Unassigned'; teamMap[t] = (teamMap[t] || 0) + countSims(c); });
            const teamRows = Object.entries(teamMap)
              .filter(([team]) => /^ufs\s*\d+$/i.test((team || '').trim()))
              .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
              .concat([['Locker', teamMap['Locker'] || 0], ['HR', teamMap['HR'] || 0]]);
            return (
              <div style={{ padding: '14px 18px', display: 'flex', flexWrap: 'nowrap', gap: 12, justifyContent: 'space-between' }}>
                {teamRows.map(([team, count]) => {
                  const isUfs = /^ufs\s*\d+$/i.test((team || '').trim());
                  return (
                    <div
                      key={team}
                      onClick={() => { if (isUfs) setUfsModal((team || '').trim().toUpperCase()); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#ffffff', border: `1px solid ${isUfs ? '#dbeafe' : '#e2e8f0'}`, borderRadius: 12, padding: '14px 18px', boxShadow: isUfs ? '0 1px 3px rgba(37,99,235,0.08)' : '0 1px 2px rgba(15,23,42,0.04)', cursor: isUfs ? 'pointer' : 'default', transition: 'box-shadow 0.15s ease, border-color 0.15s ease', flex: '1 1 0' }}
                      onMouseEnter={(e) => { if (isUfs) e.currentTarget.style.borderColor = '#93c5fd'; }}
                      onMouseLeave={(e) => { if (isUfs) e.currentTarget.style.borderColor = '#dbeafe'; }}
                    >
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: '#e0f2fe', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>{team[0] || '?'}</div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sim-ink)', whiteSpace: 'nowrap' }}>{team}</div>
                        <div style={{ fontSize: 13, color: 'var(--sim-ink-soft)', whiteSpace: 'nowrap' }}>{count} Mobile</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
      </div>

      <div className="dash-row">
        <section className="dash-panel">
          <div className="panel-head"><h3>Android Mobile Summary</h3><span className="ln">{androidCards.reduce((s, c) => s + countSims(c), 0)} Android SIMs</span></div>
          {(() => {
            const teamMap = {};
            androidCards.forEach((c) => { const t = c.team || 'Unassigned'; teamMap[t] = (teamMap[t] || 0) + countSims(c); });
            const order = ['UFS 1', 'UFS 2', 'UFS 3', 'UFS 4', 'UFS 5', 'Locker', 'Accounts', 'Social Media', 'Reception', 'Admin'];
            const teamRows = order.map((team) => [team, teamMap[team] || 0]);
            const rows = [teamRows.slice(0, 5), teamRows.slice(5, 10)];
            return (
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rows.map((row, ri) => (
                  <div key={ri} style={{ display: 'flex', flexWrap: 'nowrap', gap: 10, justifyContent: 'space-between' }}>
                    {row.map(([team, count]) => {
                      const isUfs = /^ufs\s*\d+$/i.test((team || '').trim());
                      return (
                        <div
                          key={team}
                          onClick={() => { if (isUfs) setAndroidUfsModal((team || '').trim().toUpperCase()); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#ffffff', border: `1px solid ${isUfs ? '#dbeafe' : '#e2e8f0'}`, borderRadius: 10, padding: '10px', minWidth: 0, boxShadow: isUfs ? '0 1px 3px rgba(37,99,235,0.08)' : '0 1px 2px rgba(15,23,42,0.04)', cursor: isUfs ? 'pointer' : 'default', transition: 'box-shadow 0.15s ease, border-color 0.15s ease', flex: '1 1 0' }}
                          onMouseEnter={(e) => { if (isUfs) e.currentTarget.style.borderColor = '#93c5fd'; }}
                          onMouseLeave={(e) => { if (isUfs) e.currentTarget.style.borderColor = '#dbeafe'; }}
                        >
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: '#e0f2fe', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{team[0] || '?'}</div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sim-ink)', whiteSpace: 'nowrap' }}>{team}</div>
                            <div style={{ fontSize: 11, color: 'var(--sim-ink-soft)', whiteSpace: 'nowrap' }}>{count} Mobile</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}
        </section>
      </div>

      <MobileSummaryModal
        open={!!modal}
        mobileType={modal?.deviceType || 'Nokia'}
        cardType={modal?.cardType || 'total'}
        records={modal?.deviceType === 'Nokia' ? nokiaCards : androidCards}
        onClose={() => setModal(null)}
      />

      <UfsDistributionModal
        open={!!ufsModal}
        category={ufsModal}
        records={nokiaCards}
        onClose={() => setUfsModal(null)}
      />

      <UfsDistributionModal
        open={!!androidUfsModal}
        category={androidUfsModal}
        records={androidCards}
        onClose={() => setAndroidUfsModal(null)}
      />

      <div className="dash-row">
        <section className="dash-panel">
          <div className="panel-head"><h3>SIM Status Overview</h3><span className="ln">Live distribution</span></div>
          <div className="status-layout">
            <Donut segments={statusSegments} total={data.total} />
            <div className="legend">
              {statusSegments.map((s) => (
                <div className="legend-row" key={s.label}>
                  <span className="dot" style={{ background: s.color }} />
                  <span className="nm">{s.label}</span>
                  <span className="vl">{s.value}</span>
                  <span className="pc">{Math.round((s.value / statusSumAll) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="dash-row">
        <section className="dash-panel">
          <div className="panel-head"><h3>SIM Expiry Overview</h3><span className="ln">Based on auto-expiry dates</span></div>
          <div className="expiry-grid">
            {expiryItems.map((e) => (
              <div className="expiry-item" key={e.label}>
                <div className="t"><span className="lab">{e.label}</span><span className="val">{e.val}</span></div>
                <div className="bar"><span style={{ width: `${(e.val / expiryMax) * 100}%`, background: e.color }} /></div>
              </div>
            ))}
          </div>
        </section>

        <section className="dash-panel">
          <div className="panel-head"><h3>Quick Actions</h3></div>
          <div className="qa-grid">
            <button className="qa-item qa-add sim-btn primary" style={{ justifyContent: 'center', flexDirection: 'row' }} onClick={onAdd}>
              <Icon name="sim" size={16} /> + Add SIM Card
            </button>
            {quickActions.map((qa) => (
              <Link to={qa.path} className="qa-item" key={qa.label}>
                <span className="qic" style={{ background: qa.bg, color: qa.color }}><Icon name={qa.icon} size={15} /></span>
                {qa.label}
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="dash-row">
        <section className="dash-panel">
          <div className="panel-head"><h3>SIMs Expiring Soon</h3><Link to="/sim/expiring" className="panel-link">View all →</Link></div>
          {data.urgent.length === 0 ? (
            <div className="dash-empty">
              <div className="check"><Icon name="check" size={20} /></div>
              <div className="big">No urgent expiries</div>
              <div className="small">All SIMs have more than 30 days remaining.</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="dash-table">
                <thead>
                  <tr><th>SIM / Mobile ID</th><th>Team</th><th>Expiry Date</th><th>Days Left</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {data.urgent.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.mobile_id}</td>
                      <td>{c.team || '\u2014'}</td>
                      <td>{formatDate(c.expiry_date)}</td>
                      <td className={`days-cell num ${dayClass(c.days_left)}`}>{c.days_left === null || c.days_left === undefined || Number.isNaN(c.days_left) ? '\u2014' : `${c.days_left} days`}</td>
                      <td><span className={`pill ${pillForStatus(c._status)}`}>{c._status}</span></td>
                      <td><button className="mini-btn" onClick={() => onView(c)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
