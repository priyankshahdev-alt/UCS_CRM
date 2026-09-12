import { Fragment, useEffect, useState } from 'react';
import { useHR } from '../store';
import { Dropdown } from './ui';
import * as XLSX from 'xlsx-js-style';
import { API_BASE } from '../../../lib/apiBase';
import { deptLabel } from '../../../lib/labels';

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

function fmtTime(iso) {
  if (!iso) return <span className="time-cell dim">&mdash;</span>;
  const d = new Date(new Date(iso).getTime() + IST_OFFSET);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return <span className="time-cell">{hh}:{mm}</span>;
}

function fmtTimeStr(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + IST_OFFSET);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function fmtTime12(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + IST_OFFSET);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mm} ${ampm}`;
}

function fmtDuration(mins) {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function LiveHours({ punchIn, punchOut }) {
  const punchInMs = new Date(punchIn).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (punchOut) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [punchOut]);

  if (punchOut) {
    const d = new Date(punchOut).getTime();
    const diff = Math.max(0, (d - punchInMs) / 60000);
    return <span className="time-cell">{fmtDuration(diff)}</span>;
  }

  const diff = Math.max(0, (now - punchInMs) / 60000);
  return <span className="time-cell" style={{ fontWeight: 700, color: 'var(--sage)' }}>{fmtDuration(diff)}</span>;
}

function getIstDateStr(date) {
  const ist = new Date(date.getTime() + IST_OFFSET);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function Badge({ status }) {
  const map = {
    present: { cls: 'badge-present', lbl: 'Present' },
    late: { cls: 'badge-late', lbl: 'Late' },
    absent: { cls: 'badge-absent', lbl: 'Absent' },
    leave: { cls: 'badge-leave', lbl: 'Leave' },
  };
  const { cls, lbl } = map[status] || { cls: 'badge-pending', lbl: status || '\u2014' };
  return <span className={`badge ${cls}`}>{lbl}</span>;
}

function SkeletonRows({ rows = 8, widths = [], avatarCol = 0 }) {
  return (
    Array.from({ length: rows }).map((_, i) => (
      <tr key={i} aria-hidden="true">
        {widths.map((w, c) => (
          <td key={c}>
            {c === avatarCol ? (
              <>
                <span className="sk" style={{ display:'inline-block', width:10, height:10, borderRadius:'50%', marginRight:6, verticalAlign:'middle' }} />
                <span className="sk" style={{ display:'inline-block', width:w, height:13, verticalAlign:'middle' }} />
              </>
            ) : (
              <span className="sk" style={{ display:'inline-block', width:w, height:12 }} />
            )}
          </td>
        ))}
      </tr>
    ))
  );
}

function SkeletonStats() {
  return (
    Array.from({ length: 4 }).map((_, i) => (
      <div className="stat" key={i}>
        <div className="sk" style={{ width:64, height:11, margin:'0 auto 6px', borderRadius:4 }} />
        <div className="sk" style={{ width:34, height:18, margin:'0 auto', borderRadius:4 }} />
      </div>
    ))
  );
}

export default function Attendance() {
  const { fetchAttendance, fetchWorkers } = useHR();
  const [attendance, setAttendance] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('today');
  const [historyView, setHistoryView] = useState('list');
  const [punchStatus, setPunchStatus] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilterH, setDeptFilterH] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [dayFilter, setDayFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchToday, setSearchToday] = useState('');
  const [searchWorker, setSearchWorker] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [workerAttendance, setWorkerAttendance] = useState([]);
  const [addingRecord, setAddingRecord] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [addPunchIn, setAddPunchIn] = useState('');
  const [addPunchOut, setAddPunchOut] = useState('');
  const [addStatus, setAddStatus] = useState('present');
  const [addLoading, setAddLoading] = useState(false);

  const depts = [...new Set((workers || []).map(w => w.department).filter(Boolean))].sort();
  const roles = [...new Set((workers || []).map(w => (w.department || 'Team Member')).filter(Boolean))].sort();

  const todayIST = getIstDateStr(new Date());
  const allToday = attendance.filter(a => a.date === todayIST);
  const todayMap = {};
  allToday.forEach(r => { todayMap[r.worker_id] = r; });

  const todayCombined = (workers || []).filter(w => {
    if (w.employment_status === 'absconded') return false;
    const role = w.department || 'Team Member';
    if (roleFilter && role !== roleFilter) return false;
    return true;
  }).map(w => {
    const record = todayMap[w.id];
    if (record) { record.workers = w; return record; }
    return {
      id: 'absent-' + w.id,
      worker_id: w.id,
      date: todayIST,
      status: 'absent',
      punch_in_time: null,
      punch_out_time: null,
      late_minutes: 0,
      hours_worked: null,
      workers: w,
    };
  });
  const todaySorted = [...todayCombined].sort((a, b) => {
    const aAbsent = a.status === 'absent';
    const bAbsent = b.status === 'absent';
    if (aAbsent !== bAbsent) return aAbsent ? 1 : -1;
    if (!aAbsent && !bAbsent) {
      const aIn = a.punch_in_time || 'Z';
      const bIn = b.punch_in_time || 'Z';
      return aIn < bIn ? -1 : aIn > bIn ? 1 : 0;
    }
    return 0;
  });
  const todaySearched = todaySorted.filter(r => {
    if (!searchToday) return true;
    const n = (r.workers?.name || '').toLowerCase();
    return n.includes(searchToday.toLowerCase());
  });
  const todayRecords = punchStatus ? todaySearched.filter(r => r.status === punchStatus) : todaySearched;

  useEffect(() => {
    const d = new Date();
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setMonthFilter(m);
    Promise.all([fetchAttendance(), fetchWorkers()]).then(([a, w]) => {
      setAttendance(Array.isArray(a) ? a : []);
      setWorkers(Array.isArray(w) ? w : []);
      setLoading(false);
    }).catch((err) => { console.error('API error:', err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    if (selectedWorker) {
      const records = attendance.filter(a => a.worker_id === selectedWorker.id && a.id && !a.id.startsWith('absent-'));
      setWorkerAttendance(records);
    }
  }, [attendance, selectedWorker]);

  const handleRefresh = () => {
    window.location.reload();
  };

  const refreshData = async () => {
    setRefreshing(true);
    setLoading(true);
    try {
      const [a, w] = await Promise.all([fetchAttendance(), fetchWorkers()]);
      setAttendance(Array.isArray(a) ? a : []);
      setWorkers(Array.isArray(w) ? w : []);
    } catch (e) {
      console.error('Refresh failed:', e);
      alert('Failed to refresh data. Please try again.');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  const historyRecords = attendance.filter(r => {
    const worker = workers.find(w => w.id === r.worker_id);
    if (worker && worker.employment_status === 'absconded') return false;
    if (worker && !r.workers?.id) r.workers = worker;
    if (dayFilter) {
      if (r.date !== dayFilter) return false;
    } else if (monthFilter) {
      if (!r.date.startsWith(monthFilter)) return false;
    }
    if (statusFilter && r.status !== statusFilter) return false;
    if (deptFilterH) {
      const w = r.workers || {};
      if (w.department !== deptFilterH) return false;
    }
    if (searchWorker) {
      const w = r.workers || {};
      const name = (w.name || '').toLowerCase();
      const lid = (w.login_id || '').toLowerCase();
      const s = searchWorker.toLowerCase();
      if (!name.includes(s) && !lid.includes(s)) return false;
    }
    return true;
  });

  const detailStart = dayFilter || (monthFilter ? monthFilter + '-01' : '');
  const detailEnd = dayFilter || (monthFilter
    ? (() => { const [y, m] = monthFilter.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })()
    : '');
  const toISTStr = (d) => {
    const ist = new Date(d.getTime() + IST_OFFSET);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
  };
  const detailDates = [];
  if (detailStart && detailEnd) {
    const cur = new Date(detailStart + 'T00:00:00+05:30');
    const stop = new Date(detailEnd + 'T00:00:00+05:30');
    while (cur <= stop) { detailDates.push(toISTStr(cur)); cur.setUTCDate(cur.getUTCDate() + 1); }
  }
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dowOf = (dateStr) => new Date(dateStr + 'T00:00:00Z').getUTCDay();
  const detailWorkers = (workers || []).filter(w => {
    if (w.employment_status === 'absconded') return false;
    if (deptFilterH && (w.department || '') !== deptFilterH) return false;
    if (searchWorker) {
      const n = (w.name || '').toLowerCase();
      const lid = (w.login_id || '').toLowerCase();
      const s = searchWorker.toLowerCase();
      if (!n.includes(s) && !lid.includes(s)) return false;
    }
    return true;
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const detailRecordsOf = (w) => attendance.filter(r => r.worker_id === w.id
    && (!detailStart || r.date >= detailStart) && (!detailEnd || r.date <= detailEnd));
  const cellFor = (w, dateStr, fmt = fmtTimeStr) => {
    const rec = attendance.find(r => r.worker_id === w.id && r.date === dateStr);
    const joinDate = (w.created_at || '').slice(0, 10);
    if (rec) {
      const s = rec.status;
      if (s === 'absent') return { in: 'A', out: '', status: 'absent' };
      if (s === 'leave') return { in: 'L', out: '', status: 'leave' };
      if (s === 'half-day') return { in: fmt(rec.punch_in_time), out: 'h', status: 'half-day' };
      return { in: fmt(rec.punch_in_time), out: fmt(rec.punch_out_time), status: s };
    }
    if (joinDate && dateStr === joinDate) return { in: 'J', out: '', status: 'joined' };
    if (joinDate && dateStr < joinDate) return { in: '-', out: '-', status: 'joined' };
    if (dowOf(dateStr) === 0) return { in: '', out: '', status: 'sunday' };
    if (dateStr >= todayIST) return { in: '', out: '', status: '' };
    return { in: 'A', out: '', status: 'absent' };
  };
  const cellCls = (c) => {
    if (!c) return '';
    if (c.status === 'absent') return 'cell-absent';
    if (c.status === 'leave') return 'cell-leave';
    if (c.status === 'half-day') return 'cell-half';
    if (c.status === 'sunday') return 'cell-sunday';
    if (c.status === 'joined' && c.in === 'J') return 'cell-joined';
    return '';
  };
  const detailTotalMinutes = (w) => {
    let total = 0;
    for (const r of detailRecordsOf(w)) {
      if (r.punch_in_time && r.punch_out_time) {
        total += Math.max(0, (new Date(r.punch_out_time).getTime() - new Date(r.punch_in_time).getTime()) / 60000);
      }
    }
    return Math.round(total);
  };

  const viewWorker = (workerId) => {
    const worker = workers.find(w => w.id === workerId);
    if (!worker) return;
    setSelectedWorker(worker);
  };
  const backToOverview = () => {
    setSelectedWorker(null);
  };

  const handleExportExcel = () => {
    try {
      const rows = buildSummaryRows();
      if (rows.length === 0) { alert('No workers match the selected filters for this period. Try clearing the Status/Department filter or picking a different month.'); return; }
      const cellDates = (arr) => (arr && arr.length) ? JSON.stringify(arr) : '';
      const wsData = [
        ['Name', 'Department', 'Present', 'Half Day Dates', 'Half Day Count', 'Absent Dates', 'Absent Count', 'Leave', 'Late Deduction', 'Total Days'],
        ...rows.map(r => [r.Name, r.Department, r.Present, cellDates(r['Half Day Dates']), r['Half Day Count'], cellDates(r['Absent Dates']), r['Absent Count'], r.Leave, r['Late Deduction'], r.Total]),
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [
        { wch: 24 }, { wch: 16 }, { wch: 10 }, { wch: 28 },
        { wch: 12 }, { wch: 32 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
      ];
      const header = ws['A1'];
      header.s = { font: { bold: true }, fill: { fgColor: { rgb: 'FFE8E8E8' } }, alignment: { horizontal: 'center' } };
      for (let i = 1; i < wsData.length; i++) {
        const r = i + 1;
        const halfDayCell = ws['D' + r];
        const halfDayCountCell = ws['E' + r];
        const absentCell = ws['F' + r];
        const absentCountCell = ws['G' + r];
        const lateCell = ws['I' + r];
        const vH = wsData[i][3];
        const vA = wsData[i][5];
        const vL = wsData[i][8];
        if (vH) {
          halfDayCell.s = { fill: { fgColor: { rgb: 'FFEBDDF7' } }, font: { bold: true, color: { rgb: 'FF7B3FB3' } } };
          halfDayCountCell.s = { fill: { fgColor: { rgb: 'FFEBDDF7' } }, font: { bold: true, color: { rgb: 'FF7B3FB3' } } };
        }
        if (vA) {
          absentCell.s = { fill: { fgColor: { rgb: 'FFFBD7D7' } }, font: { bold: true, color: { rgb: 'FFC53030' } } };
          absentCountCell.s = { fill: { fgColor: { rgb: 'FFFBD7D7' } }, font: { bold: true, color: { rgb: 'FFC53030' } } };
        }
        if (vL) {
          lateCell.s = { fill: { fgColor: { rgb: 'FFFFF3CD' } }, font: { bold: true, color: { rgb: 'FFB45309' } } };
        }
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance Summary');
      const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      link.download = `attendance-summary-${monthFilter || 'history'}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) { alert(e.message); }
  };

  const handleExportJSON = () => {
    try {
      const rows = buildSummaryRows();
      if (rows.length === 0) { alert('No workers match the selected filters for this period. Try clearing the Status/Department filter or picking a different month.'); return; }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }));
      link.download = `attendance-summary-${monthFilter || 'history'}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) { alert(e.message); }
  };

  const handleExportDetailExcel = () => {
    try {
      if (detailDates.length === 0) { alert('Select a month or a single day first.'); return; }
      if (detailWorkers.length === 0) { alert('No workers match the selected filters for this period.'); return; }
      const header = ['Name', 'In/Out', ...detailDates.map(d => d.slice(5)), 'Total Hrs'];
      const wsData = [header];
      for (const w of detailWorkers) {
        wsData.push(['', 'In', ...detailDates.map(d => cellFor(w, d, fmtTime12).in), fmtDuration(detailTotalMinutes(w))]);
        wsData.push([w.name, 'Out', ...detailDates.map(d => cellFor(w, d, fmtTime12).out), '']);
        wsData.push(Array(3 + detailDates.length).fill(''));
      }
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [{ wch: 22 }, { wch: 7 }, ...detailDates.map(() => ({ wch: 8 })), { wch: 10 }];
      const lastDataCol = 2 + detailDates.length;
      for (let c = 0; c <= lastDataCol; c++) {
        const addr = XLSX.utils.encode_col(c) + '1';
        if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'FFE8E8E8' } }, alignment: { horizontal: 'center' } };
      }
      for (let i = 1; i < wsData.length; i++) {
        const rowNum = i + 1;
        if (i % 3 === 2) {
          for (let c = 0; c <= lastDataCol; c++) {
            const addr = XLSX.utils.encode_col(c) + rowNum;
            if (ws[addr]) ws[addr].s = { fill: { fgColor: { rgb: 'FF111111' } }, font: { color: { rgb: 'FF111111' } } };
          }
          continue;
        }
        const cell = ws['A' + rowNum];
        if (cell) cell.s = { font: { bold: true } };
        const totalCell = ws[XLSX.utils.encode_col(lastDataCol) + rowNum];
        if (totalCell && totalCell.v) totalCell.s = { font: { bold: true }, fill: { fgColor: { rgb: 'FFE8F5E9' } } };
        for (let j = 0; j < detailDates.length; j++) {
          const v = wsData[i][2 + j];
          const addr = XLSX.utils.encode_col(2 + j) + rowNum;
          const c = ws[addr];
          if (!c) continue;
          if (v === 'A') c.s = { fill: { fgColor: { rgb: 'FFFDE2E1' } }, font: { bold: true, color: { rgb: 'FFB91C1C' } } };
          else if (v === 'L') c.s = { fill: { fgColor: { rgb: 'FFFEF3C7' } }, font: { bold: true, color: { rgb: 'FFB45309' } } };
          else if (v === 'h') c.s = { fill: { fgColor: { rgb: 'FFFFEDD5' } }, font: { bold: true, color: { rgb: 'FFC2410C' } } };
        }
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Detail Attendance');
      const xlsxBuf = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([xlsxBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      link.download = `detail-attendance-${monthFilter || (dayFilter || 'history')}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) { alert(e.message); }
  };

  const buildSummaryRows = () => {
    const startDate = dayFilter || (monthFilter ? monthFilter + '-01' : '');
    const endDate = dayFilter || (monthFilter
      ? (() => { const [y, m] = monthFilter.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })()
      : '');
    const today = todayIST;
    const periodEnd = (endDate && endDate < today) ? endDate : today;
    const statusActive = !!statusFilter;
    const toIST = (date) => {
      const d = new Date(date.getTime() + IST_OFFSET);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    const weekdayIST = (dateStr) => {
      const d = new Date(dateStr + 'T00:00:00+05:30');
      return new Date(d.getTime() + IST_OFFSET).getUTCDay();
    };
    const isSunday = (dateStr) => weekdayIST(dateStr) === 0;
    const addDays = (dateStr, n) => {
      const d = new Date(dateStr + 'T00:00:00+05:30');
      d.setUTCDate(d.getUTCDate() + n);
      return toIST(d);
    };
    const rows = [];
    for (const w of workers) {
      if (w.employment_status === 'absconded') continue;
      if (deptFilterH && (w.department || '') !== deptFilterH) continue;
      if (searchWorker) {
        const n = (w.name || '').toLowerCase();
        const lid = (w.login_id || '').toLowerCase();
        const s = searchWorker.toLowerCase();
        if (!n.includes(s) && !lid.includes(s)) continue;
      }
      const records = attendance.filter(r => r.worker_id === w.id
        && (!startDate || r.date >= startDate)
        && (!endDate || r.date <= endDate));
      const joinDate = (w.created_at || '').slice(0, 10);
      const covered = new Set(records.map(r => r.date));
      let present = 0, late = 0, halfDay = 0, leave = 0, absent = 0;
      const totalLateMinutes = records.reduce((sum, r) => sum + (r.late_minutes || 0), 0);
      let lateDeductionDays = 0;
      if (totalLateMinutes > 480) {
        lateDeductionDays = Math.round((totalLateMinutes / 480) * 2) / 2;
      } else if (totalLateMinutes > 240) {
        lateDeductionDays = 1;
      } else if (totalLateMinutes > 180) {
        lateDeductionDays = 0.5;
      }
      const halfDayDates = [];
      const absentDates = [];
      for (const r of records) {
        if (r.date < (joinDate || '0000-00-00')) continue;
        if (r.status === 'present') present++;
        else if (r.status === 'late') { present++; late++; }
        else if (r.status === 'half-day') { halfDay++; halfDayDates.push(r.date); }
        else if (r.status === 'leave') leave++;
        else if (r.status === 'absent') {
          if (!isSunday(r.date)) { absent++; absentDates.push(r.date); }
        }
      }
      if (startDate && periodEnd) {
        const cursor = new Date(startDate + 'T00:00:00+05:30');
        const stop = new Date(periodEnd + 'T00:00:00+05:30');
        while (cursor <= stop) {
          const ds = toIST(cursor);
          if (ds < today && !isSunday(ds) && ds >= (joinDate || '0000-00-00') && !covered.has(ds)) { absent++; absentDates.push(ds); }
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        const inRange = (ds) => (!startDate || ds >= startDate) && (!endDate || ds <= endDate)
          && ds < today && ds >= (joinDate || '0000-00-00');
        const absentSet = new Set(absentDates);
        const clubbed = [];
        for (const d of absentSet) {
          if (weekdayIST(d) === 1) {
            const sun = addDays(d, -1);
            if (inRange(sun)) clubbed.push(sun);
          } else if (weekdayIST(d) === 6) {
            const sun = addDays(d, 1);
            if (inRange(sun)) clubbed.push(sun);
          }
        }
        for (const sun of clubbed) {
          if (!covered.has(sun) && !absentSet.has(sun)) {
            absentSet.add(sun);
            absent++;
            absentDates.push(sun);
          }
        }
      }
      let sundayCount = 0;
      if (startDate && periodEnd) {
        const absentSetFinal = new Set(absentDates);
        const curS = new Date(startDate + 'T00:00:00+05:30');
        const stopS = new Date(periodEnd + 'T00:00:00+05:30');
        const sundays = [];
        for (let d = new Date(curS); d <= stopS; d.setUTCDate(d.getUTCDate() + 1)) {
          const ds = toIST(d);
          if (ds >= (joinDate || '0000-00-00') && isSunday(ds)) sundays.push(ds);
        }
        const regularAbsences = absentSetFinal.size > 0
          ? [...absentSetFinal].filter(ds => !isSunday(ds)).length
          : 0;
        const joinedThisMonth = !!(joinDate && startDate && joinDate.slice(0, 7) === startDate.slice(0, 7));
        const joinDay = joinDate ? parseInt(joinDate.slice(8, 10), 10) : 0;
        if (regularAbsences >= 6 || (joinedThisMonth && joinDay > 10)) {
          for (const ds of sundays) {
            if (!absentSetFinal.has(ds)) {
              absentSetFinal.add(ds);
              absent++;
              absentDates.push(ds);
            }
          }
        }
        const eligible = sundays.filter(ds => !absentSetFinal.has(ds));
        const attended = eligible.filter(ds => covered.has(ds));
        const attendedCancelled = sundays.filter(ds => absentSetFinal.has(ds) && covered.has(ds)).length;
        const attendedAll = attended.length + attendedCancelled;
        const eligibleNotWorked = eligible.length - attended.length;
        const cleanMonth = regularAbsences === 0 && !(joinedThisMonth && joinDay > 10);
        const freeCount = Math.max(0, Math.min(cleanMonth ? sundays.length : sundays.length - 1, eligibleNotWorked));
        const paid = attendedAll + freeCount;
        sundayCount = Math.max(0, paid - attendedAll);
      }
      const matches = !statusActive || (
        (statusFilter === 'present' && present - late > 0)
        || (statusFilter === 'late' && late > 0)
        || (statusFilter === 'half-day' && halfDay > 0)
        || (statusFilter === 'leave' && leave > 0)
        || (statusFilter === 'absent' && absent > 0)
      );
      if (matches) {
        rows.push({
          Name: w.name || 'Unknown',
          Department: w.department || '',
          Present: present,
          'Half Day Dates': halfDayDates.sort(),
          'Half Day Count': halfDay,
          'Absent Dates': absentDates.sort(),
          'Absent Count': absent,
          Leave: leave,
          'Late Deduction': lateDeductionDays,
          Total: Math.max(0, present + halfDay * 0.5 + leave + sundayCount - lateDeductionDays),
        });
      }
    }
    return rows.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
  };

  const onTime = todayCombined.filter(r => r.status === 'present').length;
  const lateCount = todayCombined.filter(r => r.status === 'late').length;
  const absentCount = todayCombined.filter(r => r.status === 'absent').length;
  const total = todayCombined.length;

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .matrix-table { border-collapse: collapse; font-size: 12px; }
        .matrix-table th, .matrix-table td { border: 1px solid #d1d5db; padding: 3px 6px; text-align: center; white-space: nowrap; }
        .matrix-table thead th { background: #f3f4f6; font-size: 11px; }
        .matrix-table .mat-name { text-align: left; font-weight: 600; min-width: 140px; }
        .matrix-table .mat-inout { font-size: 10px; color: #6b7280; font-weight: 600; }
        .matrix-table .mat-row:nth-child(even) { background: #fafafa; }
        .matrix-table .cell-absent { background: #fde2e1; color: #b91c1c; font-weight: 700; }
        .matrix-table .cell-leave { background: #fef3c7; color: #b45309; font-weight: 700; }
        .matrix-table .cell-half { background: #ffedd5; color: #c2410c; font-weight: 700; }
        .matrix-table .cell-sunday { background: #f3f4f6; color: #9ca3af; }
        .matrix-table .cell-joined { background: #dbeafe; color: #1d4ed8; font-weight: 700; }
        .matrix-table .cell-total { background: #e8f5e9; font-weight: 700; }
        .matrix-table .mat-spacer td { background: #111; border: none; height: 7px; padding: 0; line-height: 7px; }
        @media print {
          .sidebar, .mobile-top, .topbar, .hamburger, .tabs, .filters { display: none !important; }
          .view-toggle, .seg { display: none !important; }
          .main { margin-left: 0 !important; }
          .content-body { padding: 20px !important; }
          .card { box-shadow: none !important; border: none !important; padding: 0 !important; }
          .btn, .btn-sm { display: none !important; }
          .card-title, .search-input { display: none !important; }
          .stats { gap: 6px !important; margin-bottom: 8px !important; }
          .stat { padding: 4px 10px !important; border: 1px solid #ccc !important; }
          .stat-value { font-size: 14px !important; }
          .stat-label { font-size: 9px !important; }
          table { font-size: 10px !important; border-collapse: collapse !important; width: 100% !important; }
          th, td { padding: 4px 8px !important; border: 1px solid #999 !important; text-align: left !important; }
          .matrix-table th, .matrix-table td { text-align: center !important; }
          .matrix-table .mat-name { text-align: left !important; }
          .matrix-table .mat-spacer td { border: none !important; padding: 0 !important; height: 7px !important; }
          th { background: #f0f0f0 !important; font-weight: 600 !important; }
          td { color: #000 !important; }
          .table-wrap { overflow: visible !important; }
          .dim { color: #666 !important; }
        }
      `}</style>
      {selectedWorker ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button className="btn btn-sm" onClick={backToOverview}>&larr; Back</button>
            <h2 style={{ margin: 0 }}>{selectedWorker.name}'s Attendance</h2>
            <button className="btn btn-sm" style={{ marginLeft: 'auto', background:'var(--sage)', color:'#fff', border:'none' }} onClick={() => { setAddingRecord(true); setAddDate(''); setAddPunchIn(''); setAddPunchOut(''); setAddStatus('present'); }}>+ Add Attendance</button>
          </div>

          <div className="card" style={{ padding: '20px 22px' }}>
            {loading ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Date</th><th>Punch In</th><th>Punch Out</th></tr>
                  </thead>
                  <tbody>
                    <SkeletonRows rows={6} widths={[110, 58, 58]} avatarCol={-1} />
                  </tbody>
                </table>
              </div>
            ) : workerAttendance.length === 0 ? (
              <div className="empty-state">
                <p>No attendance records found for this worker.</p>
              </div>
            ) : (
              <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Date</th><th>Punch In</th><th>Punch Out</th></tr>
                      </thead>
                      <tbody>
                        {workerAttendance.map((r, i) => (
                          <tr key={r.id} className={r.status === 'late' ? 'row-late' : ''}>
                            <td>{r.date}</td>
                            <td>{fmtTime(r.punch_in_time)}</td>
                            <td>{fmtTime(r.punch_out_time)}</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="tabs">
            <button className={'tab' + (tab === 'today' ? ' active' : '')} onClick={() => setTab('today')}>Today&#8217;s Attendance</button>
            <button className={'tab' + (tab === 'history' ? ' active' : '')} onClick={() => setTab('history')}>Attendance History</button>
          </div>

          {tab === 'today' && (
            <div>
              <div className="stats">
                {loading ? (
                  <SkeletonStats />
                ) : (
                  <>
                    <div className="stat"><div className="stat-label">Total Workers</div><div className="stat-value info">{total}</div></div>
                    <div className="stat"><div className="stat-label">Present</div><div className="stat-value success">{onTime + lateCount}</div></div>
                    <div className="stat"><div className="stat-label">Late</div><div className="stat-value warning">{lateCount}</div></div>
                    <div className="stat"><div className="stat-label">Absent</div><div className="stat-value error">{absentCount}</div></div>
                  </>
                )}
              </div>

              <div className="card" style={{ padding: '20px 22px' }}>
                <div className="card-title" style={{ justifyContent: 'space-between' }}>
                  <span>Workers Present Today &mdash; <span className="today-date">{todayIST}</span></span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Dropdown className="role-filter" value={punchStatus} onChange={e => setPunchStatus(e.target.value)}
                      options={[{value:'',label:'All'},{value:'present',label:'Present'},{value:'late',label:'Late'},{value:'absent',label:'Absent'}]} />
                    <Dropdown className="role-filter" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
                      options={[{value:'',label:'All members'}, ...roles.map(r => ({value:r, label:deptLabel(r)}))]} />
                    <input className="search-input" type="text" placeholder="Search worker&hellip;" value={searchToday} onChange={e => setSearchToday(e.target.value)} style={{ marginTop: 0, width: 140, padding: '4px 8px', fontSize: 12 }} />
                    <button className="btn btn-sm btn-primary" onClick={handleRefresh} title="Refresh" disabled={refreshing}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: refreshing ? 'spin .6s linear infinite' : 'none' }}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.4-3.4L23 10M1 14l5.1 4.4A9 9 0 0 0 20.5 15"/></svg>
                    </button>
                  </div>
                </div>

                {loading ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Name</th><th>Punch In</th><th>Punch Out</th></tr>
                      </thead>
                      <tbody>
                        <SkeletonRows rows={8} widths={[130, 58, 58]} avatarCol={0} />
                      </tbody>
                    </table>
                  </div>
                ) : todayRecords.length === 0 ? (
                  <div className="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <p>No attendance records for today yet.</p>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Name</th><th>Punch In</th><th>Punch Out</th></tr>
                      </thead>
                      <tbody>
                          {todayRecords.map((r, i) => {
                          const w = r.workers || {};
                          const cls = r.status === 'absent' ? 'row-absent' : r.status === 'late' ? 'row-late' : '';
                          return (
                            <tr key={r.id} className={cls}>
                              <td>
                                {r.status === 'absent' && <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#ef4444', marginRight:6, verticalAlign:'middle' }} />}
                                {r.status === 'late' && <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#f59e0b', marginRight:6, verticalAlign:'middle' }} />}
                                {r.status === 'present' && <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#10b981', marginRight:6, verticalAlign:'middle' }} />}
                                <a href="#" className="worker-link" onClick={e => { e.preventDefault(); viewWorker(w.id); }}><strong>{w.name || 'Unknown'}</strong></a>
                                {r.status === 'absent' && <span style={{ fontSize:10, color:'#ef4444', marginLeft:4 }}>(Absent)</span>}
                                {r.status === 'late' && <span style={{ fontSize:10, color:'#f59e0b', marginLeft:4 }}>(Late)</span>}
                              </td>
                              <td>{fmtTime(r.punch_in_time)}</td>
                              <td>{fmtTime(r.punch_out_time)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

              </div>
            </div>
          )}

          {tab === 'history' && (
            <div>
              <div className="card" style={{ padding: '20px 22px' }}>
                <div className="filters">
                  <div className="filter-group">
                    <label>Month</label>
                    <input type="month" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
                      style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line, #e5e7eb)' }} />
                   </div>
                   <div className="filter-group">
                     <label>Single Day</label>
                     <input type="date" value={dayFilter} onChange={e => setDayFilter(e.target.value)}
                       style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line, #e5e7eb)' }} />
                  </div>
                  <div className="filter-group">
                    <label>Department</label>
                    <Dropdown value={deptFilterH} onChange={e => setDeptFilterH(e.target.value)}
                      options={[{value:'',label:'All'}, ...depts.map(d => ({value:d,label:deptLabel(d)}))]} />
                  </div>
                  <div className="filter-group">
                    <label>Status</label>
                    <Dropdown value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                      options={[{value:'',label:'All'},{value:'present',label:'Present'},{value:'late',label:'Late'},{value:'absent',label:'Absent'}]} />
                  </div>
                  <div className="filter-group">
                    <label>Search Worker</label>
                    <input type="text" placeholder="Name or ID&hellip;" value={searchWorker} onChange={e => setSearchWorker(e.target.value)} />
                  </div>
                  <div className="filter-group" style={{ flex: 0 }}>
                    <label>&nbsp;</label>
                    <button className="btn btn-primary" onClick={refreshData} style={{ whiteSpace: 'nowrap' }} disabled={refreshing}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: refreshing ? 'spin .6s linear infinite' : 'none' }}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.4-3.4L23 10M1 14l5.1 4.4A9 9 0 0 0 20.5 15"/></svg>
                      {refreshing ? ' Refreshing...' : ' Refresh'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="card" style={{ padding: '20px 22px' }}>
                <div className="card-title" style={{ justifyContent: 'space-between' }}>
                  <span>Attendance History</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="view-toggle" style={{ display: 'inline-flex', border: '1px solid var(--line, #e5e7eb)', borderRadius: 6, overflow: 'hidden' }}>
                      <button className={'seg' + (historyView === 'list' ? ' active' : '')} style={{ border: 'none', background: historyView === 'list' ? 'var(--sage, #0f766e)' : 'transparent', color: historyView === 'list' ? '#fff' : 'inherit', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }} onClick={() => setHistoryView('list')}>List</button>
                      <button className={'seg' + (historyView === 'detail' ? ' active' : '')} style={{ border: 'none', background: historyView === 'detail' ? 'var(--sage, #0f766e)' : 'transparent', color: historyView === 'detail' ? '#fff' : 'inherit', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }} onClick={() => setHistoryView('detail')}>Detail</button>
                    </div>
                    {historyView === 'detail' && (
                      <button className="btn btn-sm btn-primary" onClick={handleExportDetailExcel}>Detail Attendance</button>
                    )}
                    {historyView === 'list' && (
                      <>
                        <button className="btn btn-sm" onClick={handleExportExcel}>Export Excel</button>
                        <button className="btn btn-sm" onClick={handleExportJSON}>Export JSON</button>
                      </>
                    )}
                    <button className="btn btn-sm" onClick={() => window.print()}>Print</button>
                  </div>
                </div>
                {loading ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Date</th><th>Name</th><th>Punch In</th><th>Punch Out</th></tr>
                      </thead>
                      <tbody>
                        <SkeletonRows rows={8} widths={[90, 130, 58, 58]} avatarCol={1} />
                      </tbody>
                    </table>
                  </div>
                ) : historyView === 'detail' ? (
                  detailWorkers.length === 0 ? (
                    <div className="empty-state">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <p>No workers found for the selected filters.</p>
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table className="matrix-table">
                        <thead>
                          <tr>
                            <th rowSpan="2">Name</th>
                            <th rowSpan="2">In/Out</th>
                            {detailDates.map(d => <th key={d} className="mat-date">{d.slice(8)}</th>)}
                            <th rowSpan="2">Total Hrs</th>
                          </tr>
                          <tr>
                            {detailDates.map(d => <th key={d} className="mat-weekday">{WEEKDAYS[dowOf(d)].slice(0, 1)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {detailWorkers.map(w => {
                            const total = fmtDuration(detailTotalMinutes(w));
                            return (
                              <Fragment key={w.id}>
                                <tr className="mat-row">
                                  <td className="mat-name" rowSpan="2">{w.name}</td>
                                  <td className="mat-inout">In</td>
                                  {detailDates.map(d => { const c = cellFor(w, d); return <td key={d} className={cellCls(c)}>{c.in}</td>; })}
                                  <td className="cell-total" rowSpan="2">{total}</td>
                                </tr>
                                <tr className="mat-row">
                                  <td className="mat-inout">Out</td>
                                  {detailDates.map(d => { const c = cellFor(w, d); return <td key={d} className={cellCls(c)}>{c.out}</td>; })}
                                </tr>
                                <tr className="mat-spacer" aria-hidden="true">
                                  <td colSpan={detailDates.length + 3}>&nbsp;</td>
                                </tr>
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : historyRecords.length === 0 ? (
                  <div className="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <p>No records found for the selected filters.</p>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr><th>Date</th><th>Name</th><th>Punch In</th><th>Punch Out</th></tr>
                      </thead>
                      <tbody>
                          {historyRecords.map((r, i) => {
                          const w = r.workers || {};
                          const cls = r.status === 'absent' ? 'row-absent' : r.status === 'late' ? 'row-late' : '';
                          return (
                            <tr key={r.id} className={cls}>
                              <td>{r.date}</td>
                              <td>
                                {r.status === 'absent' && <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#ef4444', marginRight:6, verticalAlign:'middle' }} />}
                                {r.status === 'late' && <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#f59e0b', marginRight:6, verticalAlign:'middle' }} />}
                                {r.status === 'present' && <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#10b981', marginRight:6, verticalAlign:'middle' }} />}
                                <a href="#" className="worker-link" onClick={e => { e.preventDefault(); viewWorker(w.id); }}><strong>{w.name || 'Unknown'}</strong></a>
                                {r.status === 'absent' && <span style={{ fontSize:10, color:'#ef4444', marginLeft:4 }}>(Absent)</span>}
                                {r.status === 'late' && <span style={{ fontSize:10, color:'#f59e0b', marginLeft:4 }}>(Late)</span>}
                              </td>
                              <td>{fmtTime(r.punch_in_time)}</td>
                              <td>{fmtTime(r.punch_out_time)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {addingRecord && (
        <div className="modal-overlay" onClick={() => setAddingRecord(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Add Attendance</h3>
              <button className="btn btn-sm" onClick={() => setAddingRecord(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <label className="field">
                <span>Worker</span>
                <input type="text" value={selectedWorker?.name || ''} disabled />
              </label>
              <label className="field">
                <span>Date</span>
                <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} required />
              </label>
              <label className="field">
                <span>Punch In Time</span>
                <input type="time" value={addPunchIn} onChange={e => setAddPunchIn(e.target.value)} />
              </label>
              <label className="field">
                <span>Punch Out Time</span>
                <input type="time" value={addPunchOut} onChange={e => setAddPunchOut(e.target.value)} />
              </label>
              <label className="field">
                <span>Status</span>
                <select value={addStatus} onChange={e => setAddStatus(e.target.value)}>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="leave">Leave</option>
                </select>
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setAddingRecord(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => {
                if (!addDate) { alert('Please select a date'); return; }
                setAddLoading(true);
                try {
                  const body = {
                    worker_id: selectedWorker.id,
                    date: addDate,
                    punch_in_time: addPunchIn ? `${addDate}T${addPunchIn}:00.000Z` : null,
                    punch_out_time: addPunchOut ? `${addDate}T${addPunchOut}:00.000Z` : null,
                    status: addStatus,
                  };
                  const res = await fetch(API_BASE + '/attendance', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: 'Bearer ' + localStorage.getItem('ucs_token'),
                    },
                    body: JSON.stringify(body),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({ message: 'Failed to create' }));
                    throw new Error(err.message || 'Creation failed');
                  }
                  fetchAttendance().then(setAttendance).catch((err) => { console.error('API error:', err.message); });
                  setAddingRecord(false);
                } catch (err) {
                  alert(err.message);
                } finally {
                  setAddLoading(false);
                }
              }} disabled={addLoading}>
                {addLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
