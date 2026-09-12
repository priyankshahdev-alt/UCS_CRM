import { useState, useEffect, useRef, useContext } from 'react';
import { useHR, avatarColor, avatarTint, initials, DEPTS } from '../store';
import { UcsContext } from '../../../store';
import { deptLabel } from '../../../lib/labels';
import { useTeams } from '../../../components/useTeams';
import { useSalaryPrivacy } from '../../../context/SalaryPrivacyContext';
import { api } from '../../../api/auth';
import usePasteImage from '../../../utils/usePasteImage';
import { ArrowLeft, ArrowRight, Pencil, Trash } from '../icons';
import { Dropdown, DatePicker } from './ui';
import { API_BASE } from '../../../lib/apiBase';

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

function fmtTime(iso) {
  if (!iso) return '\u2014';
  const d = new Date(new Date(iso).getTime() + IST_OFFSET);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}


function Badge({ status }) {
  const map = {
    present: { cls: 'badge-present', lbl: 'Present' },
    late: { cls: 'badge-late', lbl: 'Late' },
    absent: { cls: 'badge-absent', lbl: 'Absent' },
    leave: { cls: 'badge-leave', lbl: 'Leave' },
    'half-day': { cls: 'badge-half-day', lbl: 'Half Day' },
  };
  const { cls, lbl } = map[status] || { cls: 'badge-pending', lbl: status || '\u2014' };
  return <span className={`badge ${cls}`}>{lbl}</span>;
}

export default function EmployeeDetail({ worker, onBack, onOffboard }) {
  const { teams: teamOptions } = useTeams();
  const { isSalaryUnlocked, promptUnlock, lockSalary, formatSalary, maskSalary } = useSalaryPrivacy();
  const { fetchWorkerById, fetchAttendance, fetchLeaves, fetchWorkerLetters, updateWorker, fetchWorkerSalaries, addWorkerSalary, updateWorkerSalary, fetchWorkerTargetForMonth, updateWorkerTarget, setAchievement, fetchWorkerAchievements, fetchIncentiveSummary, fetchWorkerAllocations, fetchWorkerSalaryAllocations, setWorkerAllocations, DEPTS, fetchNGOs, fetchHolidays, fetchWorkerLoans, fetchWorkerPeopleAllocations, saveWorkerPeopleAllocations, fetchWorkerSalaryAlloc, saveWorkerSalaryAlloc, generateWorkerSalaryAlloc, fetchSalaryHold, setSalaryHold, releaseSalaryHold } = useHR();
  const { user: currentUser } = useContext(UcsContext);
  const isAccounts = currentUser?.role === 'accounts' || currentUser?.role === 'super_admin';
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [ngos, setNgos] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [data, setData] = useState(null);
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [imgErr, setImgErr] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({});
  const [tab, setTab] = useState('overview');
  const [attStatus, setAttStatus] = useState('');
  const [salaries, setSalaries] = useState([]);
  const [salaryForm, setSalaryForm] = useState({ salary: '' });
  const [salarySubmitting, setSalarySubmitting] = useState(false);
  const [salaryNgoCount, setSalaryNgoCount] = useState(1);
  const [salaryNgo1, setSalaryNgo1] = useState('');
  const [salaryNgo2, setSalaryNgo2] = useState('');
  const [extraEditing, setExtraEditing] = useState(false);
  const [extraVal, setExtraVal] = useState('');
  const [extraSaving, setExtraSaving] = useState(false);
  const [viewingMonthKey, setViewingMonthKey] = useState(null);
  const [salaryHold, setSalaryHoldData] = useState(null);
  const [holdBusy, setHoldBusy] = useState(false);
  const [holdModal, setHoldModal] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [currentTarget, setCurrentTarget] = useState(null);
  const [targetEditing, setTargetEditing] = useState(false);
  const [targetEditVal, setTargetEditVal] = useState('');
  const [targetSaving, setTargetSaving] = useState(false);
  const [workerAchs, setWorkerAchs] = useState([]);
  const [incSummary, setIncSummary] = useState(null);
  const [achForm, setAchForm] = useState({});
  const [achSaving, setAchSaving] = useState({});
  const [allocations, setAllocations] = useState([]);
  const [editNgoAllocations, setEditNgoAllocations] = useState([]);
  const [peopleAllocs, setPeopleAllocs] = useState([]);
  const [peopleForm, setPeopleForm] = useState([]);
  const [editingPeople, setEditingPeople] = useState(false);
  const [peopleSaving, setPeopleSaving] = useState(false);
  const [salaryAllocMonth, setSalaryAllocMonth] = useState(null);
  const [salaryAllocs, setSalaryAllocs] = useState([]);
  const [salarySplitForm, setSalarySplitForm] = useState([]);
  const [editingSalary, setEditingSalary] = useState(false);
  const [salarySaving, setSalarySaving] = useState(false);
  const [generatingSalary, setGeneratingSalary] = useState(false);
  const [allocMsg, setAllocMsg] = useState('');
  const [sundayBonus, setSundayBonus] = useState(null);
  const [workerLoans, setWorkerLoans] = useState([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef(null);

  const uploadPhotoBase64 = async (base64, mime_type) => {
    setPhotoUploading(true);
    try {
      const res = await api(`/onboarding/admin/upload-photo/${worker.id}`, {
        method: 'POST',
        body: JSON.stringify({ photo_base64: base64, mime_type }),
        _prefix: 'ucs',
      });
      if (res.photo_url) {
        setData(prev => prev ? { ...prev, photo_url: res.photo_url } : prev);
        setImgErr(false);
      }
    } finally {
      setPhotoUploading(false);
    }
  };

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => uploadPhotoBase64(reader.result.split(',')[1], file.type);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePhotoPaste = usePasteImage(({ base64, mime }) => {
    uploadPhotoBase64(base64, mime);
  });

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    Promise.all([
      fetchWorkerById(worker.id).catch((err) => { console.error('Error:', err.message); }),
      fetchWorkerLetters(worker.id).catch((err) => { console.error('Error:', err.message); return []; }),
      fetchWorkerSalaries(worker.id).catch(() => []),
      fetchWorkerAllocations(worker.id).catch(() => []),
      fetchWorkerLoans(worker.id).catch(() => []),
      fetchWorkerPeopleAllocations(worker.id).catch(() => []),
    ]).then(([d, l, s, a, wl, pAllocs]) => {
      if (cancelled) return;
      setData(d);
      setLetters(l || []);
      setSalaries(s || []);
      setAllocations(a || []);
      setWorkerLoans(wl || []);
      setPeopleAllocs(pAllocs || []);
      setLoading(false);

      if (d?.department === 'FRO') {
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        fetchWorkerTargetForMonth(worker.id, month)
          .then(t => setCurrentTarget(t?.target_amount || null))
          .catch((err) => { console.error('API error:', err.message); });
        fetchWorkerAchievements(worker.id, month)
          .then(a => setWorkerAchs(Array.isArray(a) ? a : []))
          .catch((err) => { console.error('API error:', err.message); });
        fetchIncentiveSummary(worker.id, month)
          .then(s => setIncSummary(s?.hasIncentive ? s : null))
          .catch((err) => { console.error('API error:', err.message); });
      }
    });
    fetchAttendance().then(setAttendance).catch((err) => { console.error('API error:', err.message); });
    fetchLeaves().then(setLeaves).catch((err) => { console.error('API error:', err.message); });
    fetchNGOs().then(setNgos).catch((err) => { console.error('API error:', err.message); });
    fetchHolidays().then(setHolidays).catch((err) => { console.error('API error:', err.message); });
    const nowM = new Date();
    const curMonth = `${nowM.getFullYear()}-${String(nowM.getMonth() + 1).padStart(2, '0')}-01`;
    setSalaryAllocMonth(curMonth);
    fetchWorkerSalaryAlloc(worker.id, curMonth)
      .then(r => setSalaryAllocs(r?.allocations || []))
      .catch((err) => { console.error('API error:', err.message); });
    return () => { cancelled = true; };
  }, [worker.id]);

  // Fetch Sunday pay + incentive data whenever the viewing month changes
  useEffect(() => {
    if (data) {
      const monthKey = viewingMonthKey || defaultMonthKey;
      const month = monthKey + '-01';
      fetchWorkerSalaryAllocations(worker.id, month)
        .then(r => setSundayBonus(r?.sundayBonus || null))
        .catch((err) => { console.error('API error:', err.message); });
      if (data.department === 'FRO') {
        fetchWorkerTargetForMonth(worker.id, month)
          .then(t => setCurrentTarget(t?.target_amount || null))
          .catch((err) => { console.error('API error:', err.message); });
        fetchWorkerAchievements(worker.id, month)
          .then(a => setWorkerAchs(Array.isArray(a) ? a : []))
          .catch((err) => { console.error('API error:', err.message); });
        fetchIncentiveSummary(worker.id, month)
          .then(s => setIncSummary(s?.hasIncentive ? s : null))
          .catch((err) => { console.error('API error:', err.message); });
      }
      fetchSalaryHold(worker.id, monthKey)
        .then(h => setSalaryHoldData({ held: !!h?.held, reason: h?.reason || '', held_at: h?.held_at || null }))
        .catch((err) => { console.error('API error:', err.message); setSalaryHoldData({ held:false, reason:'', held_at:null }); });
    }
  }, [viewingMonthKey, worker.id, data?.department]);

  const handlerHoldSalary = async () => {
    setHoldBusy(true);
    try {
      await setSalaryHold(worker.id, effectiveMonthKey, holdReason.trim());
      const h = await fetchSalaryHold(worker.id, effectiveMonthKey);
      setSalaryHoldData({ held: !!h?.held, reason: h?.reason || '', held_at: h?.held_at || null });
      setHoldModal(false);
      setHoldReason('');
    } catch (e) {
      alert(e.message);
    } finally {
      setHoldBusy(false);
    }
  };

  const handlerReleaseSalary = async () => {
    if (!window.confirm(`Release salary for ${effectiveMonthKey}? The worker will move back to Released.`)) return;
    setHoldBusy(true);
    try {
      await releaseSalaryHold(worker.id, effectiveMonthKey);
      setSalaryHoldData({ held: false, reason: '', held_at: null });
    } catch (e) {
      alert(e.message);
    } finally {
      setHoldBusy(false);
    }
  };

  const startEdit = () => {
    setForm({
      name: data.name || '',
      email: data.email || '',
      gender: data.gender || '',
      dob: data.dob || '',
      phone: data.phone || '',
      alternate_phone: data.alternate_phone || '',
      department: data.department || '',
      team: (data.team || ''),
      ngo_id: data.ngo_id || '',
      address: data.address || '',
      city: data.city || '',
      state: data.state || '',
      pincode: data.pincode || '',
      permanent_address: data.permanent_address || '',
      father_husband_name: data.father_husband_name || '',
      marital_status: data.marital_status || '',
      pan_number: data.pan_number || '',
      aadhar_number: data.aadhar_number || '',
      created_at: data.created_at ? new Date(data.created_at).toLocaleDateString('en-CA') : '',
      is_active: data.is_active !== false,
      account_holder_name: data.account_holder_name || '',
      bank_name: data.bank_name || '',
      ifsc_code: data.ifsc_code || '',
      account_number: data.account_number || '',
      correspondence_address: data.correspondence?.address || '',
      correspondence_city: data.correspondence?.city || '',
      correspondence_state: data.correspondence?.state || '',
      correspondence_pincode: data.correspondence?.pincode || '',
    });
    setEditNgoAllocations(allocations.map(a => a.ngo_id));
    setEditing(true);
    setErr('');
  };

  const cancelEdit = () => { setEditing(false); setErr(''); setEditNgoAllocations([]); };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const payload = { ...form };
      if (!payload.dob) payload.dob = null;
      if (!payload.created_at) delete payload.created_at;
      else payload.created_at = payload.created_at + 'T00:00:00.000Z';
      payload.correspondence = {
        address: payload.correspondence_address || '',
        city: payload.correspondence_city || '',
        state: payload.correspondence_state || '',
        pincode: payload.correspondence_pincode || '',
      };
      delete payload.correspondence_address;
      delete payload.correspondence_city;
      delete payload.correspondence_state;
      delete payload.correspondence_pincode;
      await updateWorker(worker.id, payload);
      if (form.department === 'NGO Admin' && editNgoAllocations.length > 0) {
        try {
          await setWorkerAllocations(worker.id, editNgoAllocations.map(id => ({ ngo_id: id, salary_portion: 0 })), 0);
        } catch (e) { console.error('Error:', e.message); }
      }
      const fresh = await fetchWorkerById(worker.id);
      setData(fresh); setEditing(false); setEditNgoAllocations([]);
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = () => {
    onBack();
    if (onOffboard) onOffboard(worker);
  };

  const setField = (key) => (e) => setForm(f => ({ ...f, [key]: e?.target?.value ?? e }));
  const setBool = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.checked }));

  if (loading) return <SkeletonDetail onBack={onBack} />;
  if (!data) return <div className="empty">Volunteer not found.</div>;

  const color = avatarColor(data.name);

  const empAttendance = attendance.filter(a => a.worker_id === worker.id);
  const filteredAttendance = attStatus ? empAttendance.filter(a => a.status === attStatus) : empAttendance;

  const empLeaves = leaves.filter(l => l.worker_id === worker.id);

  const ngoName = ngos.find(n => n.id === data.ngo_id)?.name || 'NA';

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'salary', label: 'Salary' },
    { key: 'leaves', label: 'Leaves' },
    { key: 'loans', label: 'Loans & Advances' },
    { key: 'settings', label: 'Settings' },
  ];

  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET);
  const defaultMonthKey = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, '0')}`;
  const sortedSalaries = [...salaries].sort((a, b) => (b.from_month || '').localeCompare(a.from_month || ''));

  const effectiveMonthKey = viewingMonthKey || defaultMonthKey;
  const [yr, mo] = effectiveMonthKey.split('-').map(Number);
  const monthKey = effectiveMonthKey;
  const holidayDates = new Set(
    holidays.filter(h => h.date?.startsWith(monthKey)).map(h => h.date)
  );
  const daysInMonth = new Date(yr, mo, 0).getDate();

  // IST today for current-month cutoff
  const isCurrentMonth = (yr === istNow.getUTCFullYear() && mo === (istNow.getUTCMonth() + 1));
  const viewingToday = isCurrentMonth ? istNow.getUTCDate() : daysInMonth + 1;

  // Salary covering the viewing month
  const activeSalary = sortedSalaries.find(s =>
    (s.from_month || '').slice(0, 7) <= effectiveMonthKey &&
    (!s.to_month || s.to_month.slice(0, 7) >= effectiveMonthKey)
  ) || sortedSalaries[0] || null;
  const salaryPaid = activeSalary?.paid_at;

  const monthAttendance = empAttendance.filter(a => a.date && a.date.startsWith(monthKey));
  const noAttendanceData = monthAttendance.length === 0;

  const joinDate = new Date(data.created_at);
  const joinMonth = `${joinDate.getFullYear()}-${String(joinDate.getMonth() + 1).padStart(2, '0')}`;
  const joinedThisMonth = joinMonth === monthKey;
  const joinDayNum = joinDate.getDate();
  const joinCutoff = (data.created_at || '').slice(0, 10);

  // Compute absent dates — days with no attendance or explicitly absent
  const absentDates = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (joinedThisMonth && dateStr < joinCutoff) continue;
    const dt = new Date(yr, mo - 1, d);
    if (dt.getDay() === 0) continue;
    if (holidayDates.has(dateStr)) continue;
    if (d > viewingToday) continue;
    const att = monthAttendance.find(a => a.date === dateStr);
    if (!att || att.status === 'absent') {
      absentDates.push(dateStr);
    }
  }
  const absentDatesAfterJoin = absentDates.filter(d => !joinedThisMonth || d >= joinCutoff);

  // New-joiner check: ≤ 3 months employed (IST)
  const istNowDate = new Date(Date.now() + IST_OFFSET);
  const monthsEmp = (istNowDate.getUTCFullYear() - joinDate.getFullYear()) * 12 + (istNowDate.getUTCMonth() - joinDate.getMonth());
  const monthsEmployed = (istNowDate.getUTCDate() >= joinDate.getDate()) ? monthsEmp + 1 : monthsEmp;

  const deducted = new Set();
  const deductionNotes = [];
  for (const d of absentDates) {
    if (joinedThisMonth && d < joinCutoff) continue;
    const dt = new Date(d);
    const day = dt.getDay();
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day];
    const label = `${dayName} ${dt.getDate()} ${dt.toLocaleString('en-GB',{month:'short'})}`;
    if (day === 6) {
      deducted.add(d);
      const sun = new Date(dt);
      sun.setDate(sun.getDate() + 1);
      const sunDate = sun.toISOString().slice(0, 10);
      if (!joinedThisMonth || sunDate >= joinCutoff) deducted.add(sunDate);
      deductionNotes.push({ day: d, text: `${label} → absent → deducted: ${label} + Sun ${sun.getDate()} ${sun.toLocaleString('en-GB',{month:'short'})}` });
    } else if (day === 1) {
      deducted.add(d);
      const sun = new Date(dt);
      sun.setDate(sun.getDate() - 1);
      const sunDate = sun.toISOString().slice(0, 10);
      if (!joinedThisMonth || sunDate >= joinCutoff) deducted.add(sunDate);
      deductionNotes.push({ day: d, text: `${label} → absent → deducted: Sun ${sun.getDate()} ${sun.toLocaleString('en-GB',{month:'short'})} + ${label}` });
    } else {
      deducted.add(d);
      deductionNotes.push({ day: d, text: `${label} → absent → deducted: ${label}` });
    }
  }

  const availableDays = isCurrentMonth
    ? Math.min(daysInMonth, viewingToday) - (joinedThisMonth ? joinDayNum - 1 : 0)
    : joinedThisMonth ? (daysInMonth - joinDayNum + 1) : daysInMonth;

  const monSatAbsences = absentDates.filter(d => {
    const dt = new Date(d);
    return dt.getDay() !== 0 && d >= joinCutoff;
  }).length;

  const extraSundays = [];
  if (monSatAbsences >= 6 || (joinedThisMonth && joinDayNum > 10)) {
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(yr, mo - 1, d);
      if (dt.getDay() === 0) {
        const dateStr = `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (!joinedThisMonth || dateStr >= joinCutoff) {
          if (!deducted.has(dateStr)) {
            extraSundays.push(dateStr);
          }
          deducted.add(dateStr);
        }
      }
    }
  }

  const monthDays = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const dateStr = `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(yr, mo - 1, d);
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
    const att = monthAttendance.find(a => a.date === dateStr);
    let status = att?.status || null;
    if (!status && d <= viewingToday && dt.getDay() !== 0 && !holidayDates.has(dateStr) && !(joinedThisMonth && dateStr < joinCutoff)) {
      status = 'absent';
    }
    return { date: dateStr, day: d, dayName, att, status };
  });

  const daysWorked = monthAttendance.filter(a =>
    (a.status === 'present' || a.status === 'late') && (!joinedThisMonth || a.date >= joinCutoff)
  ).length;
  const presentDays = daysWorked;
  const halfDayCount = monthAttendance.filter(a =>
    a.status === 'half-day' && (!joinedThisMonth || a.date >= joinCutoff)
  ).length;
  const sundayCount = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    if (joinedThisMonth && d < joinDayNum) return 0;
    if (isCurrentMonth && d > viewingToday) return 0;
    return new Date(yr, mo - 1, d).getDay() === 0 ? 1 : 0;
  }).reduce((a, b) => a + b, 0);
  const sundayDates = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const dateStr = `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (joinedThisMonth && dateStr < joinCutoff) return null;
    if (isCurrentMonth && d > viewingToday) return null;
    return new Date(yr, mo - 1, d).getDay() === 0 ? dateStr : null;
  }).filter(Boolean);
  const eligibleSundays = sundayDates.filter(d => !deducted.has(d));
  const attendedEligible = eligibleSundays.filter(d =>
    monthAttendance.some(a => a.date === d && (a.status === 'present' || a.status === 'late'))
  );
  const attendedCancelledList = sundayDates.filter(d =>
    deducted.has(d) && monthAttendance.some(a => a.date === d && (a.status === 'present' || a.status === 'late'))
  );
  const attendedAll = attendedEligible.length + attendedCancelledList.length;
  const eligibleNotWorked = eligibleSundays.length - attendedEligible.length;
  const cleanMonth = absentDates.length === 0 && !(joinedThisMonth && joinDayNum > 10);
  const freeCount = Math.max(0, Math.min(cleanMonth ? sundayCount : sundayCount - 1, eligibleNotWorked));
  const paidSundayCount = attendedAll + freeCount;
  const unpaidSundays = eligibleSundays
    .filter(d => !attendedEligible.includes(d))
    .slice(0, Math.max(0, eligibleNotWorked - freeCount));
  for (const d of unpaidSundays) deducted.add(d);
  let paidDays = noAttendanceData ? 0 : presentDays - attendedAll + (halfDayCount * 0.5) + paidSundayCount;
  if (paidDays < 0) paidDays = 0;
  const JOINING_DEDUCTION = 1.5;
  const joiningDeduction = (joinedThisMonth && monthsEmployed <= 3) ? JOINING_DEDUCTION : 0;
  const perDay = activeSalary ? parseFloat(activeSalary.salary) / daysInMonth : 0;

  // Late-minutes-based deductions
  const totalLateMinutes = monthAttendance
    .filter(a => !joinedThisMonth || a.date >= joinCutoff)
    .reduce((sum, a) => sum + (a.late_minutes || 0), 0);

  let lateDeductionDays = 0;
  let totalDue;

  if (totalLateMinutes > 480) {
    lateDeductionDays = Math.round((totalLateMinutes / 480) * 2) / 2;
  } else if (totalLateMinutes > 240) {
    lateDeductionDays = 1;
  } else if (totalLateMinutes > 180) {
    lateDeductionDays = 0.5;
  }
  totalDue = perDay * Math.max(0, paidDays - lateDeductionDays - joiningDeduction);

  // Loan / Advance deductions
  const activeLoans = workerLoans.filter(l =>
    l.status === 'active' || l.status === 'approved'
  );
  const loanDeductionTotal = activeLoans.reduce((sum, l) => sum + parseFloat(l.monthly_deduction || 0), 0);

  // Pay date: 10th of next month + absent days on 1st–10th (excl Sundays)
  const absent1to10 = monthAttendance.filter(a =>
    a.status === 'absent' && a.date.slice(8, 10) <= '10' && new Date(a.date).getDay() !== 0 && !holidayDates.has(a.date)
  );
  const extendDays = absent1to10.length;
  const payDate = new Date(yr, mo - 1, 10 + extendDays);
  if (payDate.getDay() === 0) payDate.setDate(payDate.getDate() + 1);
  const payDateStr = payDate.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });

  // All months from a minimum of August to now (extends earlier if the
  // employee has a join date or salary history before that)
  const allMonthKeys = [];
  {
    let startY = now.getFullYear(), startM = 8;
    if (now.getMonth() + 1 < 8) startY -= 1;
    const firstOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
    const consider = (d) => {
      if (!d) return;
      const t = firstOfMonth(d).getTime();
      const st = new Date(startY, startM - 1, 1).getTime();
      if (t < st) { startY = d.getFullYear(); startM = d.getMonth() + 1; }
    };
    if (data?.created_at) consider(new Date(data.created_at));
    sortedSalaries.forEach(s => consider(new Date(s.from_month)));
    const ny = now.getFullYear(), nm = now.getMonth() + 1;
    let y = startY, m = startM;
    while (y < ny || (y === ny && m <= nm)) {
      allMonthKeys.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
    }
  }

  // Previous month data for compact summary
  const prevMonthDate = new Date(yr, mo - 2, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const prevSalaryRec = sortedSalaries.find(s =>
    (s.from_month || '').slice(0, 7) <= prevMonthKey &&
    (!s.to_month || s.to_month.slice(0, 7) >= prevMonthKey)
  ) || (allMonthKeys.includes(prevMonthKey) ? activeSalary : null);
  let prevTotalDue = null;
  if (prevSalaryRec) {
    const pYr = parseInt(prevMonthKey.split('-')[0]);
    const pMo = parseInt(prevMonthKey.split('-')[1]);
    const pDays = new Date(pYr, pMo, 0).getDate();
    const pHolidays = new Set(holidays.filter(h => h.date?.startsWith(prevMonthKey)).map(h => h.date));
    const pAtt = empAttendance.filter(a => a.date?.startsWith(prevMonthKey));
    const pJoinMonth = `${new Date(data.created_at).getFullYear()}-${String(new Date(data.created_at).getMonth() + 1).padStart(2, '0')}`;
    const pJoined = pJoinMonth === prevMonthKey;
    const pJoinCutoff = (data.created_at || '').slice(0, 10);
    const pAbsent = pAtt.filter(a => a.status === 'absent' && !pHolidays.has(a.date)).map(a => a.date);
    const pAvailable = pJoined ? (pDays - new Date(data.created_at).getDate() + 1) : pDays;
    const pPerDay = parseFloat(prevSalaryRec.salary) / pDays;

    const pDeducted = new Set();
    for (const d of pAbsent) {
      if (pJoined && d < pJoinCutoff) continue;
      const dt = new Date(d);
      const pDay = dt.getDay();
      if (pDay === 6) {
        pDeducted.add(d);
        const sun = new Date(dt); sun.setDate(sun.getDate() + 1);
        const sd = sun.toISOString().slice(0, 10);
        if (!pJoined || sd >= pJoinCutoff) pDeducted.add(sd);
      } else if (pDay === 1) {
        pDeducted.add(d);
        const sun = new Date(dt); sun.setDate(sun.getDate() - 1);
        const sd = sun.toISOString().slice(0, 10);
        if (!pJoined || sd >= pJoinCutoff) pDeducted.add(sd);
      } else {
        pDeducted.add(d);
      }
    }
    const pMonSat = pAbsent.filter(d => new Date(d).getDay() !== 0 && d >= pJoinCutoff).length;
    if (pMonSat >= 6) {
      for (let d = 1; d <= pDays; d++) {
        const dt = new Date(pYr, pMo - 1, d);
        if (dt.getDay() === 0) {
          const ds = `${pYr}-${String(pMo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          if (!pJoined || ds >= pJoinCutoff) pDeducted.add(ds);
        }
      }
    }
    const pLateMins = pAtt.filter(a => !pJoined || a.date >= pJoinCutoff).reduce((s, a) => s + (a.late_minutes || 0), 0);
    let pLateDays = 0;
    if (pLateMins > 480) pLateDays = Math.round((pLateMins / 480) * 2) / 2;
    else if (pLateMins > 240) pLateDays = 1;
    else if (pLateMins > 180) pLateDays = 0.5;
    const pPaid = Math.max(0, pAvailable - pDeducted.size);
    const pJoining = (pJoined && monthsEmployed <= 3) ? 1.5 : 0;
    prevTotalDue = pPerDay * Math.max(0, pPaid - pLateDays - pJoining);
  }

  const fmtMonthYear = (d) => d.toLocaleDateString('en-GB', { month:'long', year:'numeric' });

  return (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <button className="btn back-btn" onClick={onBack} style={{ marginBottom:0 }}><ArrowLeft width={16}/> Back to </button>
        {!editing ? (
          <div style={{ display:'flex', gap:4 }}>
            <button className="btn btn-icon" onClick={startEdit} title="Edit Volunteer"><Pencil width={16} /></button>
            <button className="btn btn-icon" onClick={handleDelete} title="Delete Volunteer" style={{ color:'var(--danger)' }}><Trash width={16} /></button>
          </div>
        ) : (
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-sm" onClick={cancelEdit} disabled={saving}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving\u2026' : 'Save'}</button>
          </div>
        )}
      </div>

      {err && <div className="err-banner">{err}</div>}

      <div className="detail-split">
        <div className="detail-sidebar-wrap">
        <div className="card detail-sidebar">
          <div style={{ textAlign:'center', padding:'24px 0 12px', position:'relative' }}>
            <input ref={photoInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handlePhotoSelect} />
            <div onClick={() => editing && photoInputRef.current?.click()} onPaste={editing ? handlePhotoPaste : undefined} title={editing ? 'Click or paste (Ctrl+V) to change photo' : undefined} style={{ cursor: editing ? 'pointer' : 'default', display:'inline-block' }}>
            {data.photo_url && !imgErr ? (
              <img src={data.photo_url} alt={data.name}
                style={{ width:80, height:80, borderRadius:20, objectFit:'cover', margin:'0 auto', display:'block' }}
                onError={() => setImgErr(true)}
              />
            ) : (
              <div className="avatar" style={{ background:avatarTint(color), color, width:80, height:80, fontSize:28, borderRadius:20, margin:'0 auto' }}>
                {initials(data.name)}
              </div>
            )}
            {photoUploading && <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'rgba(0,0,0,0.5)', color:'#fff', borderRadius:20, padding:'4px 12px', fontSize:12 }}>Uploading...</div>}
            {editing && <div style={{ fontSize:11, color:'var(--ink-soft)', marginTop:4 }}>Click to change photo</div>}
            </div>
            {editing ? (
              <input value={form.name} onChange={setField('name')}
                style={{ marginTop:12, fontSize:16, fontWeight:600, textAlign:'center', border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'6px 10px', width:'100%' }} />
            ) : (
              <h3 style={{ marginTop:12, fontSize:17 }}>{data.name}</h3>
            )}
            <div style={{ color:'var(--ink-soft)', fontSize:12, marginTop:6, display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap' }}>
              {data.department && <span className="side-tag">{deptLabel(data.department)}</span>}
              <span className={'side-tag ' + (data.employment_status === 'absconded' ? 'side-tag-absconded' : data.employment_status === 'offboarded' ? 'side-tag-offboarded' : data.is_active ? 'side-tag-active' : 'side-tag-inactive')}
                style={data.employment_status === 'absconded' ? { background:'#fff3e0', color:'#e65100' } : data.employment_status === 'offboarded' ? { background:'#fce4ec', color:'#c62828' } : {}}>
                {data.employment_status === 'absconded' ? 'Absconded' : data.employment_status === 'offboarded' ? 'Offboarded' : data.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <div className="side-fields">
            <SideField label="Email" value={data.email} />
            <SideField label="Phone" value={data.phone || '\u2014'} />
            <SideField label="Gender" value={data.gender || '\u2014'} />
            <SideField label="Date of Birth" value={data.dob || '\u2014'} />
            <SideField label="Joined" value={data.created_at ? new Date(data.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '\u2014'} />
          </div>
          </div>
        </div>

        {/* RIGHT CONTENT */}
        <div className="detail-main">
          <div className="tabs" style={{ marginBottom:16 }}>
            {TABS.map(t => (
              <button key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="detail-cards-scroll">
              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-head"><h3>Personal Details</h3></div>
                <div className="detail-grid">
                  {editing ? <EditField label="Email" value={form.email} onChange={setField('email')} /> : <Field label="Email" value={data.email} />}
                  <Field label="Login ID" value={data.login_id} />
                  {editing ? (
                    <div className="detail-field">
                      <span className="detail-label">Department</span>
                      <Dropdown value={form.department} onChange={setField('department')}
                        style={{ width:'100%' }} options={DEPTS.map(d => ({ value: d, label: deptLabel(d) }))} />
                    </div>
                  ) : <Field label="Department" value={deptLabel(data.department)} />}
                  {editing ? (
                    <div className="detail-field">
                      <span className="detail-label">Team</span>
                      <Dropdown value={form.team} onChange={setField('team')}
                        style={{ width:'100%' }}
                        options={[{value:'',label:'No Team'}, ...teamOptions.map(t => ({ value:t, label:t }))]} />
                    </div>
                  ) : <Field label="Team" value={data.team || 'No Team'} />}
                  {editing && form.department === 'NGO Admin' ? (
                    <div className="detail-field" style={{ gridColumn:'1 / -1' }}>
                      <span className="detail-label">NGOs</span>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:4 }}>
                        {ngos.map(n => {
                          const active = editNgoAllocations.includes(n.id);
                          return (
                            <span key={n.id} onClick={() => setEditNgoAllocations(prev =>
                              prev.includes(n.id) ? prev.filter(id => id !== n.id) : [...prev, n.id]
                            )} style={{
                              padding:'4px 12px', borderRadius:20, fontSize:13, cursor:'pointer',
                              border:'1px solid var(--line)',
                              background: active ? '#5B6B4E' : 'var(--paper)',
                              color: active ? '#fff' : 'var(--ink)',
                              fontWeight: active ? 600 : 400,
                              userSelect:'none', transition:'all .15s',
                            }}>{n.name}</span>
                          );
                        })}
                      </div>
                    </div>
                  ) : editing ? (
                    <div className="detail-field">
                      <span className="detail-label">NGO</span>
                      <Dropdown value={form.ngo_id} onChange={setField('ngo_id')}
                        style={{ width:'100%' }}
                        options={[{value:'',label:'NA'}, ...ngos.map(n => ({value:n.id, label:n.name}))]} />
                    </div>
                  ) : <Field label="NGO" value={ngoName} />}
                  {editing ? <div className="detail-field"><span className="detail-label">Joining Date</span><DatePicker value={form.created_at} onChange={setField('created_at')} /></div> : <Field label="Joining Date" value={data.created_at ? new Date(data.created_at).toLocaleDateString() : '—'} />}
                  {editing ? <EditField label="Gender" value={form.gender} onChange={setField('gender')} /> : <Field label="Gender" value={data.gender} />}
                  {editing ? <div className="detail-field"><span className="detail-label">Date of Birth</span><DatePicker value={form.dob} onChange={setField('dob')} /></div> : <Field label="Date of Birth" value={data.dob} />}
                  {editing ? <EditField label="Phone" value={form.phone} onChange={setField('phone')} /> : <Field label="Phone" value={data.phone} />}
                  {editing ? <EditField label="Alternate Phone" value={form.alternate_phone} onChange={setField('alternate_phone')} /> : <Field label="Alternate Phone" value={data.alternate_phone} />}
                  {editing ? <EditField label="Father/Husband" value={form.father_husband_name} onChange={setField('father_husband_name')} /> : <Field label="Father/Husband" value={data.father_husband_name} />}
                  {editing ? <EditField label="Marital Status" value={form.marital_status} onChange={setField('marital_status')} /> : <Field label="Marital Status" value={data.marital_status} />}
                  {editing ? <EditField label="PAN Number" value={form.pan_number} onChange={setField('pan_number')} /> : <Field label="PAN Number" value={data.pan_number} />}
                  {editing ? <EditField label="Aadhar Number" value={form.aadhar_number} onChange={setField('aadhar_number')} /> : <Field label="Aadhar Number" value={data.aadhar_number} />}
                  {editing ? <EditField label="Permanent Address" value={form.address} onChange={setField('address')} /> : <Field label="Permanent Address" value={data.address} />}
                  {editing ? <EditField label="Correspondence Address" value={form.correspondence_address} onChange={setField('correspondence_address')} /> : <Field label="Correspondence Address" value={data.correspondence?.address || '203, Lifescape Aqunino annex chs, A.V. Nagvekar marg, old Prabhadevi opp tata press'} />}
                  {editing ? <EditField label="City" value={form.city} onChange={setField('city')} /> : <Field label="City" value={data.city} />}
                  {editing ? <EditField label="State" value={form.state} onChange={setField('state')} /> : <Field label="State" value={data.state} />}
                  {editing ? <EditField label="Pincode" value={form.pincode} onChange={setField('pincode')} /> : <Field label="Pincode" value={data.pincode} />}
                  {editing && (
                    <div className="detail-field">
                      <span className="detail-label">Active</span>
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                        <input type="checkbox" checked={form.is_active} onChange={setBool('is_active')} />
                        {form.is_active ? 'Active' : 'Inactive'}
                      </label>
                    </div>
                  )}
                </div>
              </div>

              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-head"><h3>Bank Details</h3></div>
                <div className="detail-grid">
                  {editing ? <EditField label="Account Holder" value={form.account_holder_name} onChange={setField('account_holder_name')} /> : <Field label="Account Holder" value={data.account_holder_name} />}
                  {editing ? <EditField label="Bank Name" value={form.bank_name} onChange={setField('bank_name')} /> : <Field label="Bank Name" value={data.bank_name} />}
                  {editing ? <EditField label="IFSC Code" value={form.ifsc_code} onChange={setField('ifsc_code')} /> : <Field label="IFSC Code" value={data.ifsc_code} />}
                  {editing ? <EditField label="Account Number" value={form.account_number} onChange={setField('account_number')} /> : <Field label="Account Number" value={data.account_number} />}
                </div>
              </div>

              <Field label="Onboarding" value={data.onboarding_completed ? 'Completed' : 'Pending'} />

              {[data.aadhar_front_url, data.aadhar_back_url, data.pan_card_url, data.bank_proof_url, data.light_bill_url].some(Boolean) && (
                <div className="card" style={{ marginTop:16 }}>
                  <div className="card-head"><h3>Documents</h3></div>
                  <div className="card-pad" style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {data.aadhar_front_url && <DocLink url={data.aadhar_front_url} label="Aadhar (Front)" />}
                    {data.aadhar_back_url && <DocLink url={data.aadhar_back_url} label="Aadhar (Back)" />}
                    {data.pan_card_url && <DocLink url={data.pan_card_url} label="PAN Card" />}
                    {data.bank_proof_url && <DocLink url={data.bank_proof_url} label="Bank Proof" />}
                    {data.light_bill_url && <DocLink url={data.light_bill_url} label="Light Bill" />}
                  </div>
                </div>
              )}

              {letters.length > 0 && (
                <div className="card" style={{ marginTop:16 }}>
                  <div className="card-head"><h3>Generated Letters</h3><span className="sub">{letters.length}</span></div>
                  <div className="card-pad" style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {letters.map(l => (
                      <div key={l.id} className="letter-row">
                        <span style={{ fontWeight:500 }}>{l.template?.title || 'Letter'}</span>
                        <span style={{ color:'var(--ink-soft)', fontSize:12 }}>
                          {new Date(l.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                        </span>
                        <a className="btn btn-sm" href={API_BASE + '/letters/generated/' + l.id + '/download'}
                          target="_blank" rel="noopener noreferrer"
                          style={{ marginLeft:'auto', textDecoration:'none' }}>
                          Download
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              </div>
          )}

          {tab === 'attendance' && (
            <div>
              {/* Attendance Records */}
              <div className="card" style={{ padding:'20px 22px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <button className="btn btn-icon"
                      onClick={() => {
                        const d = new Date(yr, mo - 2, 1);
                        setViewingMonthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                      }}
                      style={{ padding:4, cursor:'pointer', background:'none', border:'1px solid var(--line)', borderRadius:'var(--radius-sm)' }}>
                      <ArrowLeft width={14} />
                    </button>
                    <h3 style={{ fontSize:16, minWidth:160, textAlign:'center' }}>{fmtMonthYear(new Date(yr, mo - 1))}</h3>
                    <button className="btn btn-icon"
                      onClick={() => {
                        const d = new Date(yr, mo, 1);
                        setViewingMonthKey(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                      }}
                      style={{ padding:4, cursor:'pointer', background:'none', border:'1px solid var(--line)', borderRadius:'var(--radius-sm)' }}>
                      <ArrowRight width={14} />
                    </button>
                  </div>
                  <Dropdown className="filter-select" value={attStatus} onChange={val => setAttStatus(val?.target?.value ?? val)}
                     options={[{value:'',label:'All'},{value:'present',label:'Present'},{value:'late',label:'Late'},{value:'absent',label:'Absent'},{value:'leave',label:'Leave'},{value:'half-day',label:'Half Day'}]} />
                </div>

                {(() => {
                  const mLate = monthAttendance.reduce((s, a) => s + (a.late_minutes || 0), 0);
                  const activeIdx = mLate > 480 ? 3 : mLate > 240 ? 2 : mLate > 180 ? 1 : 0;
                  const tiers = [
                    { label:'None', sub:'≤180 min', color:'var(--sage)' },
                    { label:'Half', sub:'181–240 min', color:'var(--gold)' },
                    { label:'1 Day', sub:'241–480 min', color:'#e67e22' },
                    { label:'Proportional', sub:'>480 min', color:'var(--danger)' },
                  ];
                  return (
                    <div style={{ marginBottom:16, padding:'12px 16px', background:'var(--bg)', borderRadius:'var(--radius-sm)' }}>
                      <div style={{ fontWeight:600, fontSize:12, color:'var(--ink)', marginBottom:8 }}>Late Deduction Threshold</div>
                      <div style={{ display:'flex', gap:0 }}>
                        {tiers.map((t, i) => {
                          const active = i === activeIdx;
                          return (
                            <div key={t.label}
                              style={{
                                flex:1, textAlign:'center', padding:'6px 2px', fontSize:10,
                                background: active ? t.color : 'var(--paper)',
                                color: active ? '#fff' : 'var(--ink-soft)',
                                fontWeight: active ? 700 : 400,
                                border: '1px solid ' + (active ? t.color : 'var(--line)'),
                                borderLeft: i > 0 ? 'none' : '1px solid ' + (active ? t.color : 'var(--line)'),
                                borderRight: i < 3 ? 'none' : '1px solid ' + (active ? t.color : 'var(--line)'),
                                position:'relative',
                              }}>
                              {t.label}
                              <div style={{ fontSize:8, opacity:0.8 }}>{t.sub}</div>
                              {active && <div style={{ position:'absolute', bottom:-14, left:'50%', marginLeft:-5, width:0, height:0, borderLeft:'5px solid transparent', borderRight:'5px solid transparent', borderTop:'6px solid ' + t.color }} />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display:'flex', gap:24, alignItems:'flex-start' }}>
                  {/* Calendar */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:1, background:'var(--line)', border:'1px solid var(--line)', borderRadius:6, overflow:'hidden', fontSize:11 }}>
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
                        <div key={d} style={{ textAlign:'center', fontWeight:600, color:'var(--ink-soft)', padding:'4px 0', background:'var(--bg)' }}>{d}</div>
                      )}
                      {(() => {
                        const firstDay = new Date(yr, mo - 1, 1).getDay();
                        const cells = [];
                        for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} style={{ background:'#fff' }} />);
                        for (const md of monthDays) {
                          const s = md.status;
                          let bg, lbl;
                          if (s === 'present') { bg = '#d4edda'; lbl = '✓'; }
                          else if (s === 'late') { bg = '#fef3c7'; lbl = '⚠'; }
                          else if (s === 'absent') { bg = '#ffe0e0'; lbl = '✗'; }
                          else if (s === 'leave' || s === 'Leave') { bg = '#f3e8ff'; lbl = '✋'; }
                          else if (s === 'half-day') { bg = '#e8d5f5'; lbl = 'HD'; }
                          else if (md.dayName === 'Sun') { bg = '#f0f0f0'; lbl = '—'; }
                          else { bg = '#fff'; lbl = ''; }
                          cells.push(
                            <div key={md.date} style={{ textAlign:'center', padding:'4px 0', background:bg, fontSize:10 }}>
                              <div style={{ fontWeight:600 }}>{md.day}</div>
                              <div>{lbl}</div>
                            </div>
                          );
                        }
                        return cells;
                      })()}
                    </div>
                    <div style={{ display:'flex', gap:12, marginTop:6, fontSize:10, color:'var(--ink-soft)', flexWrap:'wrap' }}>
                      <span><span style={{ display:'inline-block', width:10, height:10, background:'#d4edda', borderRadius:2, marginRight:3, verticalAlign:'middle' }} />Present</span>
                      <span><span style={{ display:'inline-block', width:10, height:10, background:'#fef3c7', borderRadius:2, marginRight:3, verticalAlign:'middle' }} />Late</span>
                      <span><span style={{ display:'inline-block', width:10, height:10, background:'#ffe0e0', borderRadius:2, marginRight:3, verticalAlign:'middle' }} />Absent</span>
                      <span><span style={{ display:'inline-block', width:10, height:10, background:'#f3e8ff', borderRadius:2, marginRight:3, verticalAlign:'middle' }} />Leave</span>
                      <span><span style={{ display:'inline-block', width:10, height:10, background:'#f0f0f0', borderRadius:2, marginRight:3, verticalAlign:'middle' }} />Sun</span>
                    </div>
                  </div>

                  {/* Chart */}
                  <div style={{ flexShrink:0 }}>
                    {filteredAttendance.length > 0 && <AttendanceChart records={filteredAttendance} />}
                  </div>
                </div>

                {prevSalaryRec && (
                <div className="card" style={{ marginTop:16, padding:'14px 18px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                    <div>
                      <span style={{ color:'var(--ink-soft)', fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>Previous Month</span>
                      <div style={{ fontWeight:600, fontSize:15 }}>{fmtMonthYear(prevMonthDate)}</div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontWeight:700, fontSize:16 }}>
                        {prevSalaryRec.paid_at
                          ? formatSalary(prevSalaryRec.salary)
                          : formatSalary(Math.round(prevTotalDue) + parseFloat(prevSalaryRec.extra_amount || 0))
                        }
                      </div>
                      <div style={{ fontSize:12, color: prevSalaryRec.paid_at ? 'var(--sage)' : 'var(--danger)' }}>
                        {prevSalaryRec.paid_at
                          ? `✓ Paid on ${new Date(prevSalaryRec.paid_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`
                          : `⏳ Due by ${payDateStr}${extendDays > 0 ? ` (delayed ${extendDays}d)` : ''}`
                        }
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>
            </div>
          )}

          {tab === 'salary' && (
            <div>
              {/* Confidential Salary Access Bar */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                marginBottom: 16, padding: '10px 16px', borderRadius: 8,
                background: isSalaryUnlocked ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${isSalaryUnlocked ? '#bbf7d0' : '#fef08a'}`
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ fontSize: 16 }}>{isSalaryUnlocked ? '🔓' : '🔒'}</span>
                  <div>
                    <span style={{ fontWeight: 700, color: isSalaryUnlocked ? '#166534' : '#92400e' }}>
                      {isSalaryUnlocked ? 'Salary Unlocked (Viewing Full Numbers)' : 'Salary Confidential & Hidden (XXX)'}
                    </span>
                    <div style={{ fontSize: 11, color: isSalaryUnlocked ? '#15803d' : '#b45309' }}>
                      {isSalaryUnlocked ? 'You can view and update confidential salary information.' : 'Enter your access code to reveal or update confidential salary figures.'}
                    </div>
                  </div>
                </div>
                {isSalaryUnlocked ? (
                  <button className="btn btn-sm btn-outline" onClick={lockSalary} style={{ fontSize: 11, padding: '4px 12px', background: '#fff' }}>
                    🔒 Hide Salary
                  </button>
                ) : (
                  <button className="btn btn-sm btn-primary" onClick={() => promptUnlock()} style={{ fontSize: 11, padding: '5px 14px', background: 'var(--sage)', color: '#fff', border: 'none', fontWeight: 600 }}>
                    👁️ View / Update Salary
                  </button>
                )}
              </div>

              {prevSalaryRec && (
              <div className="card" style={{ marginBottom:16, padding:'14px 18px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                  <div>
                    <span style={{ color:'var(--ink-soft)', fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>Previous Month</span>
                    <div style={{ fontWeight:600, fontSize:15 }}>{fmtMonthYear(prevMonthDate)}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:700, fontSize:16 }}>
                      {prevSalaryRec.paid_at
                        ? formatSalary(prevSalaryRec.salary)
                        : formatSalary(Math.round(prevTotalDue) + parseFloat(prevSalaryRec.extra_amount || 0))
                      }
                    </div>
                    <div style={{ fontSize:12, color: prevSalaryRec.paid_at ? 'var(--sage)' : 'var(--danger)' }}>
                      {prevSalaryRec.paid_at
                        ? `✓ Paid on ${new Date(prevSalaryRec.paid_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`
                        : `⏳ Due by ${payDateStr}${extendDays > 0 ? ` (delayed ${extendDays}d)` : ''}`
                      }
                    </div>
                  </div>
                </div>
              </div>
              )}
              {/* Salary Calculator — auto for current month */}
              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-head">
                  <h3>Salary</h3>
                  <Dropdown value={effectiveMonthKey} onChange={val => setViewingMonthKey(val?.target?.value ?? val)}
                    style={{ fontSize:13, padding:'4px 8px' }}
                    renderValue={opt => opt?.label || ''}
                    options={[
                      {value: defaultMonthKey, label: `Current Month (${fmtMonthYear(now)})`},
                      ...allMonthKeys
                        .filter(mk => mk !== defaultMonthKey)
                        .sort().reverse()
                        .map(mk => {
                          const d = new Date(mk + '-01');
                          const s = sortedSalaries.find(x => x.from_month.slice(0, 7) <= mk && (!x.to_month || x.to_month.slice(0, 7) >= mk));
                          return {
                            value: mk,
                            label: `${d.toLocaleDateString('en-GB', { month:'long', year:'numeric' })} ${s?.paid_at ? '(Paid)' : '(Unpaid)'}`
                          };
                        })
                    ]} />
                </div>
                <div className="card-pad">
                  {/* Hold / Released status for the viewing month */}
                  {activeSalary && (
                    <div style={{
                      display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
                      padding:'8px 12px', marginBottom:12, borderRadius:8,
                      background: salaryHold?.held ? '#fff8e1' : '#f0fdf4',
                      border: `1px solid ${salaryHold?.held ? '#f5d78e' : '#bbf7d0'}`,
                    }}>
                      <span style={{
                        width:9, height:9, borderRadius:'50%', flexShrink:0,
                        background: salaryHold?.held ? '#eab308' : '#22c55e',
                      }} />
                      <span style={{ fontWeight:600, fontSize:13, color:'var(--ink)' }}>
                        {salaryHold?.held ? 'HELD' : 'Released'}
                      </span>
                      {salaryHold?.held && (
                        <span style={{ fontSize:12, color:'var(--ink-soft)' }}>
                          {effectiveMonthKey}{salaryHold.reason ? ` — ${salaryHold.reason}` : ''}
                        </span>
                      )}
                      {isAccounts && !salaryHold?.held && (
                        <button className="btn btn-sm" style={{ marginLeft:'auto', color:'var(--danger)', borderColor:'#f5d78e' }}
                          onClick={() => setHoldModal(true)} disabled={holdBusy}>
                          Hold Salary
                        </button>
                      )}
                      {isAccounts && salaryHold?.held && (
                        <button className="btn btn-sm" style={{ marginLeft:'auto' }}
                          onClick={handlerReleaseSalary} disabled={holdBusy}>
                          Release
                        </button>
                      )}
                    </div>
                  )}
                  {!activeSalary ? (
                    <div className="empty" style={{ padding:0 }}>No salary record for this month.</div>
                  ) : noAttendanceData ? (
                    <div className="empty" style={{ padding:0 }}>No attendance data for this month yet.</div>
                  ) : (
                    <>
                      {salaryPaid && (
                        <div style={{ textAlign:'center', marginBottom:12, padding:'8px 14px', background:'var(--sage)', color:'#fff', borderRadius:6, fontWeight:600, fontSize:13 }}>
                          ✓ Paid on {new Date(salaryPaid).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                        </div>
                      )}
                      {/* Visual header: donut + total */}
                      <div className="salary-visual">
                        <svg width="72" height="72" viewBox="0 0 72 72">
                          {(() => {
                            const r = 30, cx = 36, cy = 36, circ = 2 * Math.PI * r;
                            const ded = deducted.size;
                            const tot = availableDays || 1;
                            const paidPct = Math.max(0, tot - ded) / tot;
                            const dedPct = ded / tot;
                            const paidOff = paidPct * circ;
                            const dedOff = dedPct * circ;
                            const emptyPct = Math.max(0, daysInMonth - tot) / daysInMonth;
                            return (
                              <>
                                <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
                                {ded > 0 && (
                                  <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e67e22" strokeWidth="8"
                                    strokeDasharray={`${dedOff} ${circ - dedOff}`}
                                    strokeDashoffset={0} transform="rotate(-90 36 36)" />
                                )}
                                <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--sage)" strokeWidth="8"
                                  strokeDasharray={`${paidOff} ${circ - paidOff}`}
                                  strokeDashoffset={-dedOff} transform="rotate(-90 36 36)" />
                                <text x={cx} y={cy - 4} textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--ink)">{Math.round(paidPct * 100)}%</text>
                                <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="var(--ink-soft)">paid</text>
                              </>
                            );
                          })()}
                        </svg>
                        <div className="salary-visual-main">
                          <div className="salary-visual-total">{formatSalary(Math.round(totalDue) + parseFloat(activeSalary?.extra_amount || 0) + (sundayBonus?.incentiveAKI || 0) + (sundayBonus?.incentiveMonthly || 0) - loanDeductionTotal)}</div>
                          <div className="salary-visual-label">Total Due</div>
                        </div>
                      </div>

                      {/* Stacked bar: days breakdown */}
                      {(() => {
                        const ded = deducted.size;
                        const empty = Math.max(0, daysInMonth - availableDays);
                        const pct = (v) => (v / daysInMonth * 100).toFixed(1);
                        const cats = { present: 0, sunday: 0, deducted: 0, empty: 0 };
                        for (const md of monthDays) {
                          if (joinedThisMonth && md.date < joinCutoff) { cats.empty++; }
                          else if (deducted.has(md.date)) { cats.deducted++; }
                          else if (md.status === 'present' || md.status === 'late') { cats.present++; }
                          else if (md.status === 'half-day') { cats.present += 0.5; }
                          else if (md.dayName === 'Sun') { cats.sunday++; }
                        }
                        return (
                          <div>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--ink-soft)', marginBottom:4 }}>
                              <span>Available: {availableDays}d</span>
                              <span>Present: {(presentDays + halfDayCount * 0.5).toFixed(1)}d</span>
                              <span>Sundays paid: {paidSundayCount}/{sundayCount}d</span>
                              <span>Deducted: {ded}d</span>
                            </div>
                            <div className="salary-breakdown-bar">
                              {cats.present > 0 && <div className="salary-bar-paid" style={{ width:pct(cats.present) + '%' }} title={`${cats.present} days present`} />}
                              {cats.sunday > 0 && <div className="salary-bar-sunday" style={{ width:pct(cats.sunday) + '%' }} title={`${cats.sunday} Sundays`} />}
                              {cats.deducted > 0 && <div className="salary-bar-deducted" style={{ width:pct(cats.deducted) + '%' }} title={`${cats.deducted} days deducted`} />}
                              {cats.empty > 0 && <div className="salary-bar-empty" style={{ width:pct(cats.empty) + '%' }} title={`${cats.empty} days before join`} />}
                            </div>
                            <div className="salary-breakdown-legend">
                              <span><span className="salary-legend-dot" style={{ background:'var(--sage)' }} />Present ({cats.present}d)</span>
                              <span><span className="salary-legend-dot" style={{ background:'#f59e0b' }} />Sundays ({cats.sunday}d)</span>
                              <span><span className="salary-legend-dot" style={{ background:'var(--danger)' }} />Deducted ({cats.deducted}d)</span>
                              {cats.empty > 0 && <span><span className="salary-legend-dot" style={{ background:'var(--line)' }} />Before join ({cats.empty}d)</span>}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Key metrics */}
                      <div className="salary-metrics">
                        <div className="salary-metric">
                          <div className="salary-metric-num">{formatSalary(activeSalary.salary)}</div>
                          <div className="salary-metric-lbl">Monthly Salary</div>
                        </div>
                        <div className="salary-metric">
                          <div className="salary-metric-num">{daysInMonth}</div>
                          <div className="salary-metric-lbl">Days in Month</div>
                        </div>
                        <div className="salary-metric">
                          <div className="salary-metric-num">{daysWorked}</div>
                          <div className="salary-metric-lbl">Days Worked</div>
                        </div>
                        <div className="salary-metric">
                          <div className="salary-metric-num" style={{ color:'#f59e0b' }}>{paidSundayCount}/{sundayCount}</div>
                          <div className="salary-metric-lbl">Sundays Paid</div>
                        </div>
                        <div className="salary-metric">
                          <div className="salary-metric-num" style={{ color:'var(--danger)' }}>{totalLateMinutes}</div>
                          <div className="salary-metric-lbl">Late Minutes</div>
                        </div>
                        {lateDeductionDays > 0 && (
                          <div className="salary-metric">
                            <div className="salary-metric-num" style={{ color:'var(--danger)' }}>{lateDeductionDays}d</div>
                            <div className="salary-metric-lbl">Late Deduction</div>
                          </div>
                        )}
                        {joiningDeduction > 0 && (
                          <div className="salary-metric">
                            <div className="salary-metric-num" style={{ color:'#8B5CF6' }}>{joiningDeduction}d</div>
                            <div className="salary-metric-lbl">Joining Deduction</div>
                          </div>
                        )}
                      </div>

                      {/* Extra Amount row */}
                      <div className="salary-extra-row">
                        <span style={{ color:'var(--ink-soft)', fontSize:12 }}>Extra Amount</span>
                        {extraEditing ? (
                          <>
                            <input type="number" min="0" step="1"
                              value={extraVal}
                              onChange={e => setExtraVal(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Escape') setExtraEditing(false); }}
                              style={{ width:80, border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'2px 6px', fontSize:13, textAlign:'right' }}
                              autoFocus />
                            <button className="btn btn-xs" disabled={extraSaving}
                              style={{ background:'var(--sage)', color:'#fff', border:'none', borderRadius:'var(--radius-sm)', padding:'2px 8px', cursor:'pointer', fontSize:12 }}
                              onClick={async () => {
                                setExtraSaving(true);
                                try {
                                  const val = parseFloat(extraVal) || 0;
                                  await updateWorkerSalary(activeSalary.id, { extra_amount: val });
                                  setSalaries(p => p.map(x => x.id === activeSalary.id ? { ...x, extra_amount: val } : x));
                                  setExtraEditing(false);
                                } catch (e) { alert(e.message); }
                                finally { setExtraSaving(false); }
                              }}>
                              {extraSaving ? '\u2026' : 'Save'}
                            </button>
                            <button className="btn btn-xs"
                              style={{ background:'transparent', border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'2px 6px', cursor:'pointer', fontSize:12 }}
                              onClick={() => setExtraEditing(false)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <span style={{ fontWeight:600, fontSize:15 }}>{formatSalary(activeSalary?.extra_amount || 0)}</span>
                            <button className="btn btn-icon btn-sm" title="Add/Edit extra amount"
                              onClick={() => {
                                promptUnlock(() => {
                                  setExtraEditing(true);
                                  setExtraVal(String(parseFloat(activeSalary?.extra_amount || 0)));
                                });
                              }}>
                              <Pencil width={13} />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Visual flow */}
                      <div style={{ borderTop:'1px solid var(--line)', marginTop:16, paddingTop:16 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:16, flexWrap:'wrap' }}>
                        <Box num={availableDays} label={joinedThisMonth ? 'Available\nDays' : 'Days in\nMonth'} color="#5B6B4E" />
                        <Arrow />
                        <Box num={availableDays - paidDays} label={'Deducted\nDays'} color="#d9534f" />
                        <Equals />
                        <Box num={paidDays} label={'Paid\nDays'} color="#5B6B4E" />
                        <Times />
                        <Box num={isSalaryUnlocked ? ('₹' + perDay.toFixed(2)) : '₹ XXX'} label={'Per Day\nRate'} color="#4F6472" />
                        <Arrow />
                        <Box num={lateDeductionDays > 0 ? '-' + lateDeductionDays : '0'} label={'Late\nDeduction'} color={lateDeductionDays > 0 ? '#e67e22' : '#5B6B4E'} />
                        {joiningDeduction > 0 && <><Arrow /><Box num={'−' + joiningDeduction + 'd'} label={'Join\nDeduction'} color="#8B5CF6" /></>}
                        {(() => {
                            const sb = sundayBonus || {};
                            const akiAmt = sb.incentiveAKI || 0;
                            const monthlyAmt = sb.incentiveMonthly || 0;
                            const baseDue = Math.round(totalDue);
                            const loanDed = loanDeductionTotal;
                            const total = baseDue + akiAmt + monthlyAmt - loanDed;
                            const isFRO = data.department === 'FRO';

                            return (
                              <>
                                <Box num={formatSalary(baseDue)} label={'Salary\nDue'} color="#5B6B4E" big />
                                {loanDed > 0 && <><Arrow /><Box num={'−₹' + loanDed.toLocaleString('en-IN')} label={'Loan/\nAdvance'} color="#e67e22" /></>}
                                {isFRO && <><Arrow /><Box num={'+₹' + akiAmt.toLocaleString('en-IN')} label={'Incentive\nAKI'} color={akiAmt > 0 ? '#8B5CF6' : '#ddd'} /></>}
                                {isFRO && <><Arrow /><Box num={'+₹' + monthlyAmt.toLocaleString('en-IN')} label={'Incentive\nMonthly'} color={monthlyAmt > 0 ? '#3B82F6' : '#ddd'} /></>}
                                <Equals />
                                <Box num={formatSalary(total)} label={'Total\nDue'} color="#16a34a" big />
                              </>
                            );
                          })()}
                      </div>

                      {/* Sunday pay explanation */}
                      {activeSalary && sundayBonus && (
                        <div style={{ marginBottom:14, padding:'10px 14px', border:'1px solid #f59e0b', borderRadius:8, background:'#fffbeb', fontSize:12 }}>
                          <div style={{ fontWeight:600, color:'#92400e', marginBottom:6, fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>
                            Sunday pay — {sundayBonus.paidSundays}/{sundayBonus.totalSundays} Sundays paid this month
                          </div>
                          <table style={{ width:'100%', borderCollapse:'collapse' }}>
                            <tbody>
                              <tr>
                                <td style={{ padding:'2px 6px 2px 0', width:80, verticalAlign:'top', whiteSpace:'nowrap' }}>
                                  <span style={{ display:'inline-block', width:8, height:8, background:'#bbf7d0', borderRadius:2, marginRight:4 }} />
                                  <strong>Rule</strong>
                                </td>
                                <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                  Every Sunday worked (present/late, even a cancelled one) is paid. On top, {sundayBonus.totalSundays - 1} Sundays are paid free, capped at all {sundayBonus.totalSundays} Sundays in the month.
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                  <span style={{ display:'inline-block', width:8, height:8, background: sundayBonus.attendedSundays > 0 ? '#bbf7d0' : '#f0f0f0', borderRadius:2, marginRight:4 }} />
                                  <strong>Sundays</strong>
                                </td>
                                <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                  Total {sundayBonus.totalSundays} · Attended {sundayBonus.attendedSundays} · Paid {sundayBonus.paidSundays}
                                </td>
                              </tr>
                              {sundayBonus.sundayAKI > 0 && (
                                <tr>
                                  <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                    <span style={{ display:'inline-block', width:8, height:8, background:'#bbf7d0', borderRadius:2, marginRight:4 }} />
                                    <strong>Sunday AKI</strong>
                                  </td>
                                  <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                    ₹{sundayBonus.sundayAchievement.toLocaleString('en-IN')} achieved on attended Sundays → AKI +₹{sundayBonus.sundayAKI.toLocaleString('en-IN')}
                                  </td>
                                </tr>
                              )}
                              {unpaidSundays.length > 0 && (
                                <tr>
                                  <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                    <span style={{ display:'inline-block', width:8, height:8, background:'#fecaca', borderRadius:2, marginRight:4 }} />
                                    <strong>Not paid</strong>
                                  </td>
                                  <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                    {unpaidSundays.map(d => 'Sun ' + new Date(d).getDate()).join(', ')} — beyond the free + attended Sundays
                                  </td>
                                </tr>
                              )}
                              {data.department === 'FRO' && (sundayBonus.incentiveAKI > 0 || sundayBonus.incentiveMonthly > 0) && (
                                <tr>
                                  <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                    <span style={{ display:'inline-block', width:8, height:8, background:'#bbf7d0', borderRadius:2, marginRight:4 }} />
                                    <strong>Incentive</strong>
                                  </td>
                                  <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                    Target met → AKI +₹{sundayBonus.incentiveAKI.toLocaleString('en-IN')} · Monthly +₹{sundayBonus.incentiveMonthly.toLocaleString('en-IN')}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Late minutes badge */}
                      <div style={{ marginBottom:14 }}>
                        {totalLateMinutes > 480 ? (
                          <div style={{ padding:'10px 14px', border:'1px solid #d9534f', borderRadius:8, background:'#fff5f5', fontSize:12 }}>
                            <div style={{ fontWeight:600, color:'#d9534f' }}>⚠ {totalLateMinutes} min late ({Math.round(totalLateMinutes / 60 * 10) / 10} hrs) → {lateDeductionDays} day{lateDeductionDays !== 1 ? 's' : ''} deducted (proportional)</div>
                            <div style={{ color:'var(--ink-soft)', marginTop:4 }}>
                              Every 8 hours (480 min) of lateness = 1 day deducted.
                            </div>
                          </div>
                        ) : totalLateMinutes > 240 ? (
                          <div style={{ padding:'8px 14px', border:'1px solid #e67e22', borderRadius:8, background:'#fff8f0', fontSize:12 }}>
                            <strong style={{ color:'#e67e22' }}>{totalLateMinutes} min late → 1 day deducted</strong>
                          </div>
                        ) : totalLateMinutes > 180 ? (
                          <div style={{ padding:'8px 14px', border:'1px solid #e67e22', borderRadius:8, background:'#fff8f0', fontSize:12 }}>
                            <strong style={{ color:'#e67e22' }}>{totalLateMinutes} min late → Half day deducted</strong>
                          </div>
                        ) : totalLateMinutes > 0 ? (
                          <div style={{ padding:'8px 14px', border:'1px solid #5B6B4E', borderRadius:8, background:'#f6f9f4', fontSize:12 }}>
                            <strong style={{ color:'#5B6B4E' }}>{totalLateMinutes} min late — No deduction (≤ 180 min)</strong>
                          </div>
                        ) : null}
                      </div>

                      {/* Loan / Advance deduction info */}
                      {loanDeductionTotal > 0 && activeLoans.map(l => (
                        <div key={l.id} style={{ marginBottom:14, padding:'10px 14px', border:'1px solid #e67e22', borderRadius:8, background:'#fff8f0', fontSize:12 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:4 }}>
                            <span style={{ textTransform:'capitalize' }}><strong>{l.type}</strong> — ₹{parseFloat(l.monthly_deduction).toLocaleString('en-IN')}/mo deducted</span>
                            <span style={{ color:'var(--ink-soft)' }}>
                              Remaining: <strong style={{ color:'var(--danger)' }}>₹{parseFloat(l.remaining_amount).toLocaleString('en-IN')}</strong>
                            </span>
                          </div>
                        </div>
                      ))}

                      {/* Join info — highlighted box */}
                      {joinedThisMonth && (
                        <div style={{ marginBottom:14, padding:'10px 14px', border:'1px solid #f0d58c', borderRadius:8, background:'#fffbea', fontSize:12 }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:4 }}>
                            <span><strong>Joined:</strong> {new Date(data.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}</span>
                            <span><strong>Available:</strong> {joinDayNum} – {daysInMonth} → <span style={{ fontWeight:700, fontSize:14 }}>{availableDays} days</span></span>
                            <span><strong>Joining deduction:</strong> {joiningDeduction} days</span>
                          </div>
                        </div>
                      )}

                      {/* What's deducted — visual breakdown */}
                      {(() => {
                        const autoSundays = [...deducted].filter(d =>
                          !absentDatesAfterJoin.includes(d) &&
                          new Date(d).getDay() === 0 &&
                          !extraSundays.includes(d) &&
                          !unpaidSundays.includes(d)
                        );
                        const hasAny = absentDatesAfterJoin.length > 0 || autoSundays.length > 0 || extraSundays.length > 0 || unpaidSundays.length > 0 || lateDeductionDays > 0 || joiningDeduction > 0;
                        if (!hasAny) return null;
                        return (
                          <div style={{ marginBottom:14, padding:'10px 14px', border:'1px solid var(--danger)', borderRadius:8, background:'#fff5f5', fontSize:12 }}>
                            <div style={{ fontWeight:600, color:'var(--danger)', marginBottom:6, fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>
                              Why {deducted.size} day{deducted.size != 1 ? 's' : ''} are deducted
                            </div>
                            <table style={{ width:'100%', borderCollapse:'collapse' }}>
                              <tbody>
                                {absentDatesAfterJoin.length > 0 && (
                                  <tr>
                                    <td style={{ padding:'2px 6px 2px 0', width:80, verticalAlign:'top', whiteSpace:'nowrap' }}>
                                      <span style={{ display:'inline-block', width:8, height:8, background:'#ffe0e0', borderRadius:2, marginRight:4 }} />
                                      <strong>{absentDatesAfterJoin.length} absent</strong>
                                    </td>
                                    <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                      {absentDatesAfterJoin.map(d => {
                                        const dt = new Date(d);
                                        return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()] + ' ' + dt.getDate();
                                      }).join(', ')}
                                    </td>
                                  </tr>
                                )}
                                {autoSundays.length > 0 && (
                                  <tr>
                                    <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                      <span style={{ display:'inline-block', width:8, height:8, background:'#fce4b0', borderRadius:2, marginRight:4 }} />
                                      <strong>{autoSundays.length} Sun{autoSundays.length > 1 ? 's' : ''}</strong>
                                    </td>
                                    <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                      {autoSundays.map(d => {
                                        const dt = new Date(d);
                                        return 'Sun ' + dt.getDate();
                                      }).join(', ')}
                                      {' (Sat/Mon → next/prev Sun)'}
                                    </td>
                                  </tr>
                                )}
                                {extraSundays.length > 0 && (
                                  <tr>
                                    <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                      <span style={{ display:'inline-block', width:8, height:8, background:'#f0c0c0', borderRadius:2, marginRight:4 }} />
                                      <strong>{extraSundays.length} extra</strong>
                                    </td>
                                    <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                      {'≥6 absences rule → ' + extraSundays.map(d => {
                                        const dt = new Date(d);
                                        return 'Sun ' + dt.getDate();
                                      }).join(', ')}
                                    </td>
                                  </tr>
                                )}
                                {unpaidSundays.length > 0 && (
                                  <tr>
                                    <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                      <span style={{ display:'inline-block', width:8, height:8, background:'#fce4b0', borderRadius:2, marginRight:4 }} />
                                      <strong>{unpaidSundays.length} Sun</strong>
                                    </td>
                                    <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                      {unpaidSundays.map(d => {
                                        const dt = new Date(d);
                                        return 'Sun ' + dt.getDate();
                                      }).join(', ')}
                                      {' (beyond free + attended Sundays)'}
                                    </td>
                                  </tr>
                                )}
                                {lateDeductionDays > 0 && (
                                  <tr>
                                    <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                      <span style={{ display:'inline-block', width:8, height:8, background:'#e67e22', borderRadius:2, marginRight:4 }} />
                                      <strong>{lateDeductionDays} late</strong>
                                    </td>
                                    <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                      {totalLateMinutes} min late → {lateDeductionDays} day{lateDeductionDays !== 1 ? 's' : ''} deducted
                                    </td>
                                  </tr>
                                )}
                                {joiningDeduction > 0 && (
                                  <tr>
                                    <td style={{ padding:'2px 6px 2px 0', verticalAlign:'top', whiteSpace:'nowrap' }}>
                                      <span style={{ display:'inline-block', width:8, height:8, background:'#8B5CF6', borderRadius:2, marginRight:4 }} />
                                      <strong>{joiningDeduction} joining</strong>
                                    </td>
                                    <td style={{ padding:'2px 0', color:'var(--ink-soft)' }}>
                                      First month deduction for new joiners
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()}

                      {/* Day grid */}
                      <div style={{ marginBottom:12 }}>
                        <div style={{ color:'var(--ink-soft)', marginBottom:6, fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>Day-by-day status</div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, fontSize:10 }}>
                          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
                            <div key={d} style={{ textAlign:'center', fontWeight:600, color:'var(--ink-soft)', padding:'2px 0' }}>{d}</div>
                          )}
                          {(() => {
                            const firstDay = new Date(yr, mo - 1, 1).getDay();
                            const cells = [];
                            for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
                            for (const md of monthDays) {
                              const isDeducted = deducted.has(md.date);
                              const isWeekend = md.dayName === 'Sun';
                              const beforeJoin = joinedThisMonth && md.date < joinCutoff;
                              let bg, label, title;
                              if (beforeJoin) { bg = '#e8e8e8'; label = '—'; title = 'Before join'; }
                              else if (isDeducted) { bg = '#ffe0e0'; label = '✗'; title = 'Deducted'; }
                              else if (md.status === 'present' || md.status === 'late') { bg = '#d4edda'; label = '✓'; title = 'Present/Late'; }
                              else if (md.status === 'half-day') { bg = '#e8d5f5'; label = 'HD'; title = 'Half Day'; }
                              else if (isWeekend) { bg = '#f0f0f0'; label = '—'; title = 'Weekend'; }
                              else { bg = '#fff'; label = ''; title = ''; }
                              cells.push(
                                <div key={md.date} style={{ textAlign:'center', padding:'3px 0', borderRadius:3, background:bg, fontSize:9, position:'relative' }}>
                                  <div>{md.day}</div>
                                  <div style={{ fontWeight:600 }} title={title}>{label}</div>
                                </div>
                              );
                            }
                            return cells;
                          })()}
                        </div>
                        <div style={{ display:'flex', gap:16, marginTop:6, fontSize:10, color:'var(--ink-soft)', flexWrap:'wrap' }}>
                          <span><span style={{ display:'inline-block', width:10, height:10, background:'#d4edda', borderRadius:2, marginRight:4, verticalAlign:'middle' }} />Present/Late</span>
                          <span><span style={{ display:'inline-block', width:10, height:10, background:'#ffe0e0', borderRadius:2, marginRight:4, verticalAlign:'middle' }} />Deducted</span>
                          <span><span style={{ display:'inline-block', width:10, height:10, background:'#f0f0f0', borderRadius:2, marginRight:4, verticalAlign:'middle' }} />Weekend</span>
                          {joinedThisMonth && <span><span style={{ display:'inline-block', width:10, height:10, background:'#e8e8e8', borderRadius:2, marginRight:4, verticalAlign:'middle' }} />Before join</span>}
                          <span><span style={{ display:'inline-block', width:10, height:10, background:'#fff', border:'1px solid #ddd', borderRadius:2, marginRight:4, verticalAlign:'middle' }} />No record</span>
                        </div>
                      </div>

                      {/* Summary totals */}
                      <div style={{ borderTop:'2px solid var(--line)', paddingTop:12, marginTop:12 }}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'4px 16px', fontSize:12 }}>
                          <span style={{ color:'var(--ink-soft)' }}>Days in month</span><span style={{ textAlign:'right' }}>{daysInMonth}</span>
                          {joinedThisMonth && <><span style={{ color:'var(--ink-soft)' }}>Available (from join date)</span><span style={{ textAlign:'right' }}>{availableDays}</span></>}
                          <span style={{ color:'var(--ink-soft)' }}>Days worked (present + late)</span><span style={{ textAlign:'right' }}>{daysWorked}</span>
                          <span style={{ color:'var(--danger)' }}>Absent days (on/after join)</span><span style={{ textAlign:'right' }}>{absentDatesAfterJoin.length}</span>
                          <span style={{ color:'var(--danger)' }}>Total deducted days</span><span style={{ textAlign:'right' }}>{deducted.size}</span>
                          {lateDeductionDays > 0 && (
                            <>
                              <span style={{ color:'var(--danger)' }}>Late deduction</span><span style={{ textAlign:'right' }}>{lateDeductionDays} day{lateDeductionDays > 1 ? 's' : ''}</span>
                              <span style={{ color:'var(--ink-soft)' }}>Late minutes</span><span style={{ textAlign:'right' }}>{totalLateMinutes}</span>
                            </>
                          )}
                          {joiningDeduction > 0 && (
                            <><span style={{ color:'#8B5CF6' }}>Joining deduction</span><span style={{ textAlign:'right', color:'#8B5CF6' }}>{joiningDeduction} day{joiningDeduction > 1 ? 's' : ''}</span></>
                          )}
                          <span style={{ borderTop:'1px solid var(--line)', paddingTop:4, fontWeight:600 }}>Paid days</span>
                          <span style={{ borderTop:'1px solid var(--line)', paddingTop:4, textAlign:'right', fontWeight:600 }}>{paidDays}</span>
{loanDeductionTotal > 0 && (
                             <><span style={{ color:'#e67e22' }}>Loan/Advance deduction</span><span style={{ textAlign:'right', color:'#e67e22' }}>−₹{loanDeductionTotal.toLocaleString('en-IN')}</span></>
                           )}
                         </div>
                       </div>
                       </div>
                     </>
                   )}
                </div>
              </div>

              {/* NGO People Allocation */}
              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-head">
                  <h3>NGO Employment Split</h3>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <span className="sub">{peopleAllocs.length} NGO{peopleAllocs.length !== 1 ? 's' : ''} · {Math.round(peopleAllocs.reduce((s,a)=>s+(parseFloat(a.pct)||0),0) || 0)}% allocated</span>
                    <button className="btn btn-sm" onClick={() => {
                      setPeopleForm(peopleAllocs.length
                        ? peopleAllocs.map(a => ({ ngo_id: a.ngo_id, pct: String(a.pct) }))
                        : ngos.map(n => ({ ngo_id: n.id, pct: '' })));
                      setEditingPeople(true); setAllocMsg('');
                    }}>Edit</button>
                  </div>
                </div>
                <div className="card-pad">
                  {peopleAllocs.length === 0 ? (
                    <div style={{ color:'var(--ink-soft)', fontSize:13 }}>No NGO employment split set. Assign the employee to one or more NGOs.</div>
                  ) : (
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, fontVariantNumeric:'tabular-nums' }}>
                      <tbody>
                        {peopleAllocs.map(a => {
                          const name = ngos.find(n => n.id === a.ngo_id)?.name || a.ngo_name || 'Unknown';
                          const pct = parseFloat(a.pct) || 0;
                          return (
                            <tr key={a.id || a.ngo_id}>
                              <td style={{ padding:'4px 4px', fontWeight:500 }}>{name}</td>
                              <td style={{ padding:'4px 4px', textAlign:'right', width:110 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'flex-end' }}>
                                  <div style={{ width:64, height:6, background:'var(--line)', borderRadius:3, overflow:'hidden' }}>
                                    <div style={{ width:Math.min(100, pct)+'%', height:6, background:'var(--sage)', borderRadius:3 }} />
                                  </div>
                                  <span style={{ fontWeight:600, minWidth:36, textAlign:'right' }}>{Math.round(pct)}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* NGO Salary Allocation */}
              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-head">
                  <h3>NGO Salary Allocation</h3>
                  <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <span className="sub">{salaryAllocMonth ? salaryAllocMonth.slice(0,7) : ''}</span>
                    <button className="btn btn-sm" disabled={generatingSalary} onClick={async () => {
                      setGeneratingSalary(true); setAllocMsg('');
                      try {
                        await generateWorkerSalaryAlloc(worker.id, salaryAllocMonth);
                        const r = await fetchWorkerSalaryAlloc(worker.id, salaryAllocMonth);
                        setSalaryAllocs(r?.allocations || []);
                        setAllocMsg('Salary allocation generated from payroll.');
                      } catch (e) { setAllocMsg('Generate failed: ' + e.message); }
                      setGeneratingSalary(false);
                    }}>{generatingSalary ? '…' : 'Generate from Payroll'}</button>
                    <button className="btn btn-sm" onClick={() => {
                      promptUnlock(() => {
                        setSalarySplitForm(salaryAllocs.length
                          ? salaryAllocs.map(a => ({ ngo_id: a.ngo_id, portion: String(a.salary_portion ?? '') }))
                          : []);
                        setEditingSalary(true);
                        setAllocMsg('');
                      });
                    }}>Edit</button>
                  </div>
                </div>
                <div className="card-pad">
                  {allocMsg && <div style={{ fontSize:12, color:'var(--ink-soft)', marginBottom:8 }}>{allocMsg}</div>}
                  {salaryAllocs.length === 0 ? (
                    <div style={{ color:'var(--ink-soft)', fontSize:13 }}>No salary allocation for this month. Click <strong>Generate from Payroll</strong> to seed it from payroll, or edit to set amounts per NGO.</div>
                  ) : (
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, fontVariantNumeric:'tabular-nums' }}>
                      <tbody>
                        {salaryAllocs.map(a => {
                          const name = ngos.find(n => n.id === a.ngo_id)?.name || a.ngo_name || 'Unknown';
                          const portion = parseFloat(a.salary_portion) || 0;
                          const activeSalaryVal = parseFloat(activeSalary?.salary || 0);
                          const pct = activeSalaryVal > 0 ? (portion / activeSalaryVal) * 100 : 0;
                          return (
                            <tr key={a.id || a.ngo_id}>
                              <td style={{ padding:'4px 4px', fontWeight:500 }}>{name}</td>
                              <td style={{ padding:'4px 4px', textAlign:'right', width:140 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'flex-end' }}>
                                  <div style={{ width:64, height:6, background:'var(--line)', borderRadius:3, overflow:'hidden' }}>
                                    <div style={{ width:Math.min(100, pct)+'%', height:6, background:'var(--sage)', borderRadius:3 }} />
                                  </div>
                                  <span style={{ fontWeight:600, minWidth:110, textAlign:'right' }}>{formatSalary(portion)}{activeSalaryVal > 0 && isSalaryUnlocked ? ' · ' + Math.round(pct) + '%' : ''}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* NGO Allocations Breakdown */}
              {allocations.length > 0 && (
              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-head"><h3>NGO Allocations</h3></div>
                <div className="card-pad" style={{ overflow:'hidden' }}>
                  <table style={{ width:'100%', tableLayout:'fixed', borderCollapse:'collapse', fontSize:10, fontVariantNumeric:'tabular-nums' }}>
                    <colgroup>
                      <col style={{ width:'25%' }} />
                      <col style={{ width:'11%' }} />
                      <col style={{ width:'10%' }} />
                      <col style={{ width:'13%' }} />
                      <col style={{ width:'10%' }} />
                      <col style={{ width:'11%' }} />
                      <col style={{ width:'10%' }} />
                      <col style={{ width:'10%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ textAlign:'left', padding:'4px 3px', borderBottom:'2px solid var(--line)', whiteSpace:'nowrap', fontSize:10 }}>NGO</th>
                        <th style={{ textAlign:'right', padding:'4px 3px', borderBottom:'2px solid var(--line)', whiteSpace:'nowrap', fontSize:10 }}>Portion</th>
                        <th style={{ textAlign:'right', padding:'4px 3px', borderBottom:'2px solid var(--line)', whiteSpace:'nowrap', fontSize:10 }}>Day</th>
                        <th style={{ textAlign:'right', padding:'4px 3px', borderBottom:'2px solid var(--line)', whiteSpace:'nowrap', fontSize:10 }}>Salary</th>
                        <th style={{ textAlign:'right', padding:'4px 3px', borderBottom:'2px solid var(--line)', whiteSpace:'nowrap', fontSize:10, color:'#92400e' }}>AKI</th>
                        <th style={{ textAlign:'right', padding:'4px 3px', borderBottom:'2px solid var(--line)', whiteSpace:'nowrap', fontSize:10, color:'#92400e' }}>Mon.</th>
                        <th style={{ textAlign:'right', padding:'4px 3px', borderBottom:'2px solid var(--line)', whiteSpace:'nowrap', fontSize:10, color:'#92400e' }}>Sun.</th>
                        <th style={{ textAlign:'right', padding:'4px 3px', borderBottom:'2px solid var(--line)', whiteSpace:'nowrap', fontSize:10 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const totalSalaryVal = parseFloat(activeSalary?.salary || 0);
                        const totAKI = sundayBonus?.incentiveAKI || 0;
                        const totMonthly = sundayBonus?.incentiveMonthly || 0;
                        const totSunday = sundayBonus?.sundayAKI || 0;
                        const isIncentive = data.department === 'FRO' && (totAKI > 0 || totMonthly > 0 || totSunday > 0);

                        return allocations.map(a => {
                          const portion = parseFloat(a.salary_portion);
                          const ratio = totalSalaryVal > 0 ? portion / totalSalaryVal : 0;
                          const allocPerDay = portion / daysInMonth;
                          const allocDue = allocPerDay * Math.max(0, paidDays - lateDeductionDays - joiningDeduction);
                          const allocAKI = isIncentive ? Math.round(totAKI * ratio) : 0;
                          const allocMonthly = isIncentive ? Math.round(totMonthly * ratio) : 0;
                          const allocSunday = isIncentive ? Math.round(totSunday * ratio) : 0;
                          const allocGrand = Math.round(allocDue) + allocAKI + allocMonthly + allocSunday;
                          const ngoName = ngos.find(n => n.id === a.ngo_id)?.name || a.ngo_name || 'Unknown';

                          return (
                            <tr key={a.id || a.ngo_id}>
                              <td style={{ padding:'3px 3px', borderBottom:'1px solid var(--line)', fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', fontSize:10 }}>{ngoName}</td>
                              <td style={{ padding:'3px 3px', borderBottom:'1px solid var(--line)', textAlign:'right', whiteSpace:'nowrap', fontSize:10 }}>{formatSalary(portion)}</td>
                              <td style={{ padding:'3px 3px', borderBottom:'1px solid var(--line)', textAlign:'right', whiteSpace:'nowrap', fontSize:10 }}>{formatSalary(Math.round(allocPerDay))}</td>
                              <td style={{ padding:'3px 3px', borderBottom:'1px solid var(--line)', textAlign:'right', fontWeight:600, whiteSpace:'nowrap', fontSize:10 }}>{formatSalary(Math.round(allocDue))}</td>
                              <td style={{ padding:'3px 3px', borderBottom:'1px solid var(--line)', textAlign:'right', color: allocAKI > 0 ? '#f59e0b' : 'var(--ink-soft)', whiteSpace:'nowrap', fontSize:10 }}>
                                {allocAKI > 0 ? '₹' + allocAKI.toLocaleString('en-IN') : '₹0'}
                              </td>
                              <td style={{ padding:'3px 3px', borderBottom:'1px solid var(--line)', textAlign:'right', color: allocMonthly > 0 ? '#f59e0b' : 'var(--ink-soft)', whiteSpace:'nowrap', fontSize:10 }}>
                                {allocMonthly > 0 ? '₹' + allocMonthly.toLocaleString('en-IN') : '₹0'}
                              </td>
                              <td style={{ padding:'3px 3px', borderBottom:'1px solid var(--line)', textAlign:'right', color: allocSunday > 0 ? '#f59e0b' : 'var(--ink-soft)', whiteSpace:'nowrap', fontSize:10 }}>
                                {allocSunday > 0 ? '₹' + allocSunday.toLocaleString('en-IN') : '₹0'}
                              </td>
                              <td style={{ padding:'3px 3px', borderBottom:'1px solid var(--line)', textAlign:'right', fontWeight:700, color: allocGrand > Math.round(allocDue) ? '#16a34a' : 'var(--sage)', whiteSpace:'nowrap', fontSize:10 }}>
                                {formatSalary(allocGrand)}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                    <tfoot>
                      {(() => {
                        const totalSalaryVal = parseFloat(activeSalary?.salary || 0);
                        const totAKI = sundayBonus?.incentiveAKI || 0;
                        const totMonthly = sundayBonus?.incentiveMonthly || 0;
                        const totSunday = sundayBonus?.sundayAKI || 0;
                        const isIncentive = data.department === 'FRO' && (totAKI > 0 || totMonthly > 0 || totSunday > 0);
                        const sumDue = Math.round(allocations.reduce((s, a) => {
                          const portion = parseFloat(a.salary_portion);
                          const allocPerDay = portion / daysInMonth;
                          return s + allocPerDay * Math.max(0, paidDays - lateDeductionDays - joiningDeduction);
                        }, 0));
                        const sumAKI = isIncentive ? Math.round(totAKI) : 0;
                        const sumMonthly = isIncentive ? Math.round(totMonthly) : 0;
                        const sumSunday = isIncentive ? Math.round(totSunday) : 0;
                        const sumGrand = sumDue + sumAKI + sumMonthly + sumSunday;

                        return (
                          <>
                            <tr>
                              <td style={{ padding:'5px 3px', fontWeight:700, fontSize:10, borderTop:'2px solid var(--line)' }}>Merged Total</td>
                              <td style={{ padding:'5px 3px', textAlign:'right', fontWeight:700, fontSize:10, borderTop:'2px solid var(--line)' }}>
                                {formatSalary(totalSalaryVal)}
                              </td>
                              <td style={{ padding:'5px 3px', textAlign:'right', fontWeight:700, fontSize:10, borderTop:'2px solid var(--line)' }}>
                                {formatSalary(Math.round(perDay))}
                              </td>
                              <td style={{ padding:'5px 3px', textAlign:'right', fontWeight:700, fontSize:10, borderTop:'2px solid var(--line)', color:'var(--sage)' }}>
                                {formatSalary(sumDue)}
                              </td>
                              <td style={{ padding:'5px 3px', textAlign:'right', fontWeight:700, fontSize:10, borderTop:'2px solid var(--line)', color: sumAKI > 0 ? '#f59e0b' : 'var(--ink-soft)' }}>
                                {sumAKI > 0 ? '₹' + sumAKI.toLocaleString('en-IN') : '₹0'}
                              </td>
                              <td style={{ padding:'5px 3px', textAlign:'right', fontWeight:700, fontSize:10, borderTop:'2px solid var(--line)', color: sumMonthly > 0 ? '#f59e0b' : 'var(--ink-soft)' }}>
                                {sumMonthly > 0 ? '₹' + sumMonthly.toLocaleString('en-IN') : '₹0'}
                              </td>
                              <td style={{ padding:'5px 3px', textAlign:'right', fontWeight:700, fontSize:10, borderTop:'2px solid var(--line)', color: sumSunday > 0 ? '#f59e0b' : 'var(--ink-soft)' }}>
                                {sumSunday > 0 ? '₹' + sumSunday.toLocaleString('en-IN') : '₹0'}
                              </td>
                              <td style={{ padding:'5px 3px', textAlign:'right', fontWeight:800, fontSize:11, borderTop:'2px solid var(--line)', color:'#16a34a' }}>
                                {formatSalary(sumGrand)}
                              </td>
                            </tr>
                          </>
                        );
                      })()}
                    </tfoot>
                  </table>
                  <div style={{ marginTop:8, fontSize:11, color:'var(--ink-soft)' }}>
                    Attendance is shared across all allocations. Deductions affect each portion equally.
                    {data.department === 'FRO' && (sundayBonus?.incentiveAKI > 0 || sundayBonus?.incentiveMonthly > 0 || sundayBonus?.sundayAKI > 0) && (
                      <> Incentives (AKI, Monthly, Sunday AKI) are split proportionally by salary portion.</>
                    )}
                  </div>
                </div>
              </div>
              )}

              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-head"><h3>Add Salary</h3></div>
                <div className="card-pad">
                  {salaries.length === 0 ? (
                    <>
                      <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
                        <div>
                          <span className="detail-label">Salary Amount</span>
                          <input type="number" step="0.01" min="0" placeholder="e.g. 25000"
                            value={salaryForm.salary}
                            onChange={e => setSalaryForm(f => ({ ...f, salary: e.target.value }))}
                            style={{ border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'6px 10px', fontSize:13, width:160 }} />
                        </div>
                      </div>
                      <div style={{ marginTop:10 }}>
                        <span className="detail-label" style={{ display:'block', marginBottom:6 }}>Allocate to</span>
                        <div style={{ display:'flex', gap:8 }}>
                          <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', fontSize:13 }}>
                            <input type="radio" name="ngoCount" checked={salaryNgoCount === 1}
                              onChange={() => { setSalaryNgoCount(1); setSalaryNgo2(''); }} />
                            1 NGO
                          </label>
                          <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', fontSize:13 }}>
                            <input type="radio" name="ngoCount" checked={salaryNgoCount === 2}
                              onChange={() => setSalaryNgoCount(2)} />
                            2 NGOs
                          </label>
                        </div>
                      </div>
                      <div style={{ marginTop:10, display:'flex', gap:12, flexWrap:'wrap' }}>
                        {salaryNgoCount === 1 ? (
                          <div>
                            <span className="detail-label">NGO</span>
                            <Dropdown value={salaryNgo1} onChange={val => {
                              const v = val?.target?.value ?? val;
                              setSalaryNgo1(v);
                              setSalaryNgo2(prev => prev === v ? '' : v);
                            }}
                              options={[
                                { value: '', label: 'Select NGO' },
                                ...ngos.map(n => ({ value: n.id, label: n.name }))
                              ]}
                              style={{ minWidth:180 }} />
                          </div>
                        ) : (
                          <>
                            <div>
                              <span className="detail-label">NGO 1</span>
                              <Dropdown value={salaryNgo1} onChange={val => {
                                const v = val?.target?.value ?? val;
                                setSalaryNgo1(v);
                                setSalaryNgo2(prev => prev === v ? '' : v);
                              }}
                                options={[
                                  { value: '', label: 'Select NGO' },
                                  ...ngos.map(n => ({ value: n.id, label: n.name }))
                                ]}
                                style={{ minWidth:160 }} />
                            </div>
                            <div>
                              <span className="detail-label">NGO 2</span>
                              <Dropdown value={salaryNgo2} onChange={val => {
                                const v = val?.target?.value ?? val;
                                setSalaryNgo2(v);
                                setSalaryNgo1(prev => prev === v ? '' : v);
                              }}
                                options={[
                                  { value: '', label: 'Select NGO' },
                                  ...ngos.map(n => ({ value: n.id, label: n.name }))
                                ]}
                                style={{ minWidth:160 }} />
                            </div>
                          </>
                        )}
                      </div>
                      <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:12 }}>
                        <button className="btn btn-primary btn-sm" disabled={salarySubmitting || !salaryForm.salary || !salaryNgo1 || (salaryNgoCount === 2 && !salaryNgo2)}
                          onClick={async () => {
                            setSalarySubmitting(true);
                            try {
                              const joinDate = new Date(data.created_at);
                              const joinMonth = `${joinDate.getFullYear()}-${String(joinDate.getMonth() + 1).padStart(2, '0')}-01`;
                              const now = new Date();
                              const currMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

                              const sorted = [...salaries].sort((a, b) => b.from_month.localeCompare(a.from_month));
                              const latest = sorted[0];

                              let from_month;
                              if (!latest) {
                                from_month = joinMonth;
                              } else {
                                from_month = currMonth;
                              }

                              if (latest && !latest.to_month) {
                                const d = new Date(from_month);
                                d.setDate(0);
                                const prevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                                await updateWorkerSalary(latest.id, { to_month: prevMonth });
                                setSalaries(p => p.map(x => x.id === latest.id ? { ...x, to_month: prevMonth } : x));
                              }

                              const salNum = parseFloat(salaryForm.salary);
                              const res = await addWorkerSalary({
                                worker_id: worker.id,
                                salary: salNum,
                                from_month,
                                to_month: null,
                              });
                              setSalaries(p => [res.record, ...p]);

                              const allocs = salaryNgoCount === 1
                                ? [{ ngo_id: salaryNgo1, salary_portion: salNum }]
                                : [{ ngo_id: salaryNgo1, salary_portion: Math.round(salNum / 2) }, { ngo_id: salaryNgo2, salary_portion: Math.round(salNum / 2) }];
                              await setWorkerAllocations(worker.id, allocs, salNum);
                              setAllocations(allocs);

                              setSalaryForm({ salary: '' });
                              setSalaryNgo1('');
                              setSalaryNgo2('');
                            } catch (e) { alert(e.message); }
                            finally { setSalarySubmitting(false); }
                          }}>
                          {salarySubmitting ? 'Adding\u2026' : 'Add Salary'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div style={{ display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap' }}>
                      <div>
                        <span className="detail-label">Salary Amount</span>
                        <input type="number" step="0.01" min="0" placeholder="e.g. 25000"
                          value={salaryForm.salary}
                          onChange={e => setSalaryForm(f => ({ ...f, salary: e.target.value }))}
                          style={{ border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'6px 10px', fontSize:13, width:160 }} />
                      </div>
                      <button className="btn btn-primary btn-sm" disabled={salarySubmitting || !salaryForm.salary}
                        onClick={async () => {
                          setSalarySubmitting(true);
                          try {
                            const joinDate = new Date(data.created_at);
                            const joinMonth = `${joinDate.getFullYear()}-${String(joinDate.getMonth() + 1).padStart(2, '0')}-01`;
                            const now = new Date();
                            const currMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

                            const sorted = [...salaries].sort((a, b) => b.from_month.localeCompare(a.from_month));
                            const latest = sorted[0];

                            let from_month;
                            if (!latest) {
                              from_month = joinMonth;
                            } else {
                              from_month = currMonth;
                            }

                            if (latest && !latest.to_month) {
                              const d = new Date(from_month);
                              d.setDate(0);
                              const prevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                              await updateWorkerSalary(latest.id, { to_month: prevMonth });
                              setSalaries(p => p.map(x => x.id === latest.id ? { ...x, to_month: prevMonth } : x));
                            }

                            const res = await addWorkerSalary({
                              worker_id: worker.id,
                              salary: parseFloat(salaryForm.salary),
                              from_month,
                              to_month: null,
                            });
                            setSalaries(p => [res.record, ...p]);

                            const oldSalNum = latest ? parseFloat(latest.salary) : 0;
                            const newSalNum = parseFloat(salaryForm.salary);
                            if (allocations.length > 0 && oldSalNum > 0) {
                              const scaledAllocs = allocations.map(a => ({
                                ngo_id: a.ngo_id,
                                salary_portion: Math.round(parseFloat(a.salary_portion) * (newSalNum / oldSalNum)),
                              }));
                              await setWorkerAllocations(worker.id, scaledAllocs, newSalNum);
                              setAllocations(scaledAllocs);
                            }

                            setSalaryForm({ salary: '' });
                          } catch (e) { alert(e.message); }
                          finally { setSalarySubmitting(false); }
                        }}>
                        {salarySubmitting ? 'Adding\u2026' : 'Add Salary'}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-head"><h3>Salary History ({salaries.length} records)</h3></div>
                {salaries.length === 0 ? (
                  <div className="card-pad"><div className="empty">No salary records found.</div></div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Salary</th>
                        <th>From</th>
                        <th>To</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...salaries].sort((a, b) => b.from_month.localeCompare(a.from_month)).map((s, i) => {
                        const from = new Date(s.from_month);
                        const to = s.to_month ? new Date(s.to_month) : null;
                        const fmtMonth = (d) => d.toLocaleDateString('en-GB', { month:'long', year:'numeric' });
                        const paid = s.paid_at;
                        return (
                          <tr key={s.id}>
                            <td>{i + 1}</td>
                            <td style={{ fontWeight:600 }}>{formatSalary(s.salary)}</td>
                            <td>{fmtMonth(from)}</td>
                            <td>{to ? fmtMonth(to) : '\u2014 (Current)'}</td>
                            <td>
                              {paid ? (
                                <span className="pill pill-green">Paid</span>
                              ) : (
                                <span className="pill pill-gold">Unpaid</span>
                              )}
                            </td>
                            <td>
                              <div style={{ display:'flex', gap:4 }}>
                                <button className="btn btn-icon" title="Delete"
                                  onClick={async () => {
                                    promptUnlock(async () => {
                                      if (!confirm('Delete this salary record?')) return;
                                      try {
                                        await fetch(API_BASE + '/salary/' + s.id, { method:'DELETE', headers:{ Authorization: 'Bearer ' + localStorage.getItem('ucs_token') } });
                                        setSalaries(p => p.filter(x => x.id !== s.id));
                                      } catch (e) { alert(e.message); }
                                    });
                                  }}>
                                  <Trash width={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {data.department === 'FRO' && (
              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-head"><h3>FRO Target & Incentives</h3></div>
                <div className="card-pad">
                  {currentTarget != null ? (
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
                      <div style={{ fontSize:22, fontWeight:700, color:'var(--sage)' }}>
                        Monthly Target: ₹{currentTarget.toLocaleString('en-IN')}
                      </div>
                      {!targetEditing && (
                        <button className="btn btn-sm btn-outline" onClick={() => { setTargetEditing(true); setTargetEditVal(String(currentTarget)); }} style={{ fontSize:11, padding:'2px 8px' }}>Edit</button>
                      )}
                    </div>
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
                      <div style={{ fontSize:14, color:'var(--ink-soft)' }}>Monthly target not set</div>
                      {!targetEditing && (
                        <button className="btn btn-sm btn-primary" onClick={() => { setTargetEditing(true); setTargetEditVal(''); }} style={{ fontSize:11, padding:'2px 8px' }}>Set Target</button>
                      )}
                    </div>
                  )}

                  {targetEditing && (
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, padding:'8px 12px', background:'#f9fafb', borderRadius:8, border:'1px solid var(--line)' }}>
                      <span style={{ fontSize:13, fontWeight:600 }}>₹</span>
                      <input type="number" min="0" value={targetEditVal} onChange={e => setTargetEditVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && targetEditVal) document.getElementById('target-save-btn')?.click(); if (e.key === 'Escape') setTargetEditing(false); }}
                        autoFocus style={{ flex:1, padding:'4px 8px', fontSize:14, border:'1px solid var(--line)', borderRadius:4, outline:'none' }} />
                      <button id="target-save-btn" className="btn btn-sm btn-primary" disabled={!targetEditVal || targetSaving} onClick={async () => {
                        setTargetSaving(true);
                        try {
                          const month = `${yr}-${String(mo).padStart(2, '0')}-01`;
                          await updateWorkerTarget(data.id, month, parseFloat(targetEditVal));
                          setCurrentTarget(parseFloat(targetEditVal));
                          setTargetEditing(false);
                          const s = await fetchIncentiveSummary(data.id, month);
                          setIncSummary(s?.hasIncentive ? s : null);
                        } catch (e) { alert(e.message); }
                        finally { setTargetSaving(false); }
                      }}>{targetSaving ? '...' : 'Save'}</button>
                      <button className="btn btn-sm btn-outline" onClick={() => setTargetEditing(false)} style={{ fontSize:11 }}>Cancel</button>
                    </div>
                  )}

                  {incSummary && (
                    <div style={{ marginBottom:12, padding:'10px 14px', borderRadius:8, background: incSummary.monthlyTargetMet ? '#f0fdf4' : '#fef2f2', border:'1px solid', borderColor: incSummary.monthlyTargetMet ? '#bbf7d0' : '#fecaca' }}>
                      <div style={{ fontWeight:600, fontSize:13, color: incSummary.monthlyTargetMet ? '#16a34a' : '#ef4444', marginBottom:4 }}>
                        {incSummary.monthlyTargetMet ? '✓ Target Met' : '✗ Target Not Met — AKI forfeited'}
                      </div>
                      <div style={{ fontSize:12, color:'var(--ink-soft)' }}>
                        Achieved: ₹{incSummary.monthlyAchievement.toLocaleString('en-IN')} / ₹{incSummary.monthlyTarget.toLocaleString('en-IN')}
                        {' | '}AKI Payout: ₹{incSummary.akiPayout.toLocaleString('en-IN')} ({incSummary.isNewJoiner ? 'Full' : 'Half'})
                        {' | '}Monthly: ₹{incSummary.monthlyIncentive.toLocaleString('en-IN')}
                        {' | '}<strong style={{ color: incSummary.monthlyTargetMet ? '#16a34a' : '#ef4444' }}>Total: ₹{incSummary.totalIncentive.toLocaleString('en-IN')}</strong>
                      </div>
                    </div>
                  )}

                  <div className="salary-metrics" style={{ marginBottom:8 }}>
                    <div className="salary-metric">
                      <div className="salary-metric-num">{formatSalary(incSummary?.totalAKI || 0)}</div>
                      <div className="salary-metric-lbl">Total AKI</div>
                    </div>
                    <div className="salary-metric">
                      <div className="salary-metric-num">{formatSalary(incSummary?.monthlyIncentive || 0)}</div>
                      <div className="salary-metric-lbl">Monthly (10%)</div>
                    </div>
                    <div className="salary-metric">
                      <div className="salary-metric-num" style={{ color: incSummary?.monthlyTargetMet ? 'var(--sage)' : 'var(--danger)' }}>
                        ₹{(incSummary?.totalIncentive || 0).toLocaleString('en-IN')}
                      </div>
                      <div className="salary-metric-lbl">Total Incentive</div>
                    </div>
                  </div>

                  <div style={{ borderTop:'1px solid var(--line)', paddingTop:12 }}>
                    <div style={{ color:'var(--ink-soft)', fontSize:11, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>
                      Daily Achievements & AKI
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, fontSize:10 }}>
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
                        <div key={d} style={{ textAlign:'center', fontWeight:600, color:'var(--ink-soft)', padding:'2px 0' }}>{d}</div>
                      )}
                      {(() => {
                        const daysInMonth = new Date(yr, mo, 0).getDate();
                        const firstDay = new Date(yr, mo - 1, 1).getDay();
                        const cells = [];
                        for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />);
                        for (let d = 1; d <= daysInMonth; d++) {
                          const dateStr = `${yr}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                          const ach = workerAchs.find(a => a.date === dateStr);
                          const formKey = `ach-${dateStr}`;
                          const saving = achSaving[formKey];
                          const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                          const dayName = dayNames[new Date(dateStr).getDay()];
                          cells.push(
                            <div key={dateStr} style={{ textAlign:'center', padding:'3px 0', borderRadius:3, background: ach ? '#f0fdf4' : '#fff', fontSize:9, border:'1px solid', borderColor: ach ? '#bbf7d0' : '#f3f4f6', position:'relative' }}>
                              <div style={{ fontWeight:600 }}>{d}</div>
                              {ach ? (
                                <div style={{ color:'#16a34a', fontSize:8 }}>₹{parseFloat(ach.amount).toLocaleString('en-IN')}</div>
                              ) : (
                                <div style={{ marginTop:1 }}>
                                  <input type="number" min="0" placeholder="amt"
                                    value={achForm[formKey] || ''}
                                    onChange={e => setAchForm(f => ({ ...f, [formKey]: e.target.value }))}
                                    style={{ width:'100%', border:'none', background:'transparent', fontSize:8, textAlign:'center', padding:0, outline:'none' }}
                                    onKeyDown={async e => {
                                      if (e.key === 'Enter' && achForm[formKey]) {
                                        setAchSaving(f => ({ ...f, [formKey]: true }));
                                        try {
                                          await setAchievement(data.id, dateStr, parseFloat(achForm[formKey]));
                                          const month = `${yr}-${String(mo).padStart(2, '0')}-01`;
                                          const a = await fetchWorkerAchievements(data.id, month);
                                          setWorkerAchs(Array.isArray(a) ? a : []);
                                          const s = await fetchIncentiveSummary(data.id, month);
                                          setIncSummary(s?.hasIncentive ? s : null);
                                          setAchForm(f => ({ ...f, [formKey]: '' }));
                                        } catch (e) { alert(e.message); }
                                        finally { setAchSaving(f => ({ ...f, [formKey]: false })); }
                                      }
                                    }}
                                  />
                                  {saving && <div style={{ fontSize:7, color:'#6b7280' }}>...</div>}
                                </div>
                              )}
                            </div>
                          );
                        }
                        return cells;
                      })()}
                    </div>
                    <div style={{ display:'flex', gap:16, marginTop:6, fontSize:9, color:'var(--ink-soft)', flexWrap:'wrap' }}>
                      <span><span style={{ display:'inline-block', width:8, height:8, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:2, marginRight:3, verticalAlign:'middle' }} />AKI earned</span>
                      <span><span style={{ display:'inline-block', width:8, height:8, background:'#fff', border:'1px solid #f3f4f6', borderRadius:2, marginRight:3, verticalAlign:'middle' }} />No entry</span>
                      <span style={{ color:'var(--ink-soft)' }}>Type amount + Enter to save</span>
                    </div>
                  </div>
                </div>
              </div>
              )}

            </div>
          )}

          {tab === 'leaves' && (
            <div className="card">
              <div className="card-head"><h3>Leave History ({empLeaves.length} records)</h3></div>
              {empLeaves.length === 0 ? (
                <div className="card-pad"><div className="empty">No leave records found.</div></div>
              ) : (
                <table>
                  <thead><tr><th>From</th><th>To</th><th>Reason</th><th>Status</th></tr></thead>
                  <tbody>
                    {empLeaves.map(l => (
                      <tr key={l.id}>
                        <td>{new Date(l.from_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</td>
                        <td>{new Date(l.to_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</td>
                        <td style={{ color:'var(--ink-soft)', maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.reason || '\u2014'}</td>
                        <td><StatusPill status={l.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'loans' && (
            <div className="card">
              <div className="card-head"><h3>Loans & Advances</h3></div>
              <div className="card-pad">
                {workerLoans.length === 0 ? (
                  <div className="empty">No loans or advances.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Monthly Deduction</th>
                        <th>Paid So Far</th>
                        <th>Remaining</th>
                        <th>Status</th>
                        <th>Applied</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workerLoans.map(l => (
                        <tr key={l.id}>
                          <td style={{ textTransform:'capitalize', fontWeight:500 }}>{l.type}</td>
                          <td style={{ fontWeight:600 }}>₹{parseFloat(l.total_amount).toLocaleString('en-IN')}</td>
                          <td>{parseFloat(l.monthly_deduction || 0) > 0 ? '₹' + parseFloat(l.monthly_deduction).toLocaleString('en-IN') + '/mo' : '—'}</td>
                          <td style={{ color:'var(--sage)' }}>
                            {l.total_deducted > 0 ? '₹' + l.total_deducted.toLocaleString('en-IN') : '—'}
                          </td>
                          <td style={{ color: parseFloat(l.remaining_amount || 0) > 0 ? 'var(--danger)' : 'var(--ink-soft)', fontWeight:600 }}>
                            {parseFloat(l.remaining_amount || 0) > 0 ? '₹' + parseFloat(l.remaining_amount).toLocaleString('en-IN') : '—'}
                          </td>
                          <td>
                            <span className={`pill ${l.status === 'active' || l.status === 'approved' ? 'pill-green' : l.status === 'closed' ? 'pill-gray' : l.status === 'rejected' ? 'pill-danger' : 'pill-gold'}`}>
                              {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
                            </span>
                          </td>
                          <td style={{ color:'var(--ink-soft)' }}>
                            {(() => {
                              const dt = new Date(l.applied_at);
                              const i = new Intl.DateTimeFormat('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' }).format(dt);
                              return i.split('/').join('-');
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {tab === 'settings' && (
            <ShiftSettings workerId={data?.id} currentShift={{ start: data?.shift_start_time, end: data?.shift_end_time }} onSave={() => fetchWorkerById(worker.id).then(d => setData(d)).catch((err) => { console.error('Error:', err.message); })} />
          )}

        </div>
      </div>

      {editingPeople && (
        <div className="modal-overlay" onClick={() => setEditingPeople(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="card-pad">
              <h3 style={{ margin:'0 0 4px' }}>NGO Employment Split</h3>
              <p style={{ fontSize:12, color:'var(--ink-soft)', margin:'0 0 12px' }}>
                Assign the % of employment time per NGO. Leave empty NGOs blank. Total must equal 100%.
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
                {peopleForm.map((p, i) => (
                  <div key={p.ngo_id || i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ flex:1, fontSize:13, fontWeight:500 }}>
                      {ngos.find(n => n.id === p.ngo_id)?.name || 'NGO'}
                    </span>
                    <input type="number" min="0" max="100" value={p.pct}
                      onChange={e => setPeopleForm(f => f.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))}
                      style={{ width:80, border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'6px 8px', fontSize:13, textAlign:'right' }}
                      placeholder="%" />
                    <span style={{ width:20, textAlign:'right', fontSize:12, color:'var(--ink-soft)' }}>%</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize:12, marginBottom:12, color: (() => {
                const total = peopleForm.reduce((s, x) => s + (parseFloat(x.pct) || 0), 0);
                return total === 100 ? '#065f46' : total > 100 ? '#991b1b' : 'var(--ink-soft)';
              })() }}>
                Total: {peopleForm.reduce((s, x) => s + (parseFloat(x.pct) || 0), 0)}% (must be 100%)
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-primary btn-sm" disabled={peopleSaving || peopleForm.reduce((s, x) => s + (parseFloat(x.pct) || 0), 0) !== 100}
                  onClick={async () => {
                    setPeopleSaving(true);
                    try {
                      const allocs = peopleForm.filter(x => (parseFloat(x.pct) || 0) > 0)
                        .map(x => ({ ngo_id: x.ngo_id, pct: parseFloat(x.pct) }));
                      await saveWorkerPeopleAllocations(worker.id, allocs);
                      const r = await fetchWorkerPeopleAllocations(worker.id);
                      setPeopleAllocs(r || []);
                      setEditingPeople(false);
                    } catch (e) { setAllocMsg(e.message); }
                    setPeopleSaving(false);
                  }}>
                  {peopleSaving ? 'Saving...' : 'Save'}
                </button>
                <button className="btn btn-sm" onClick={() => setEditingPeople(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingSalary && (
        <div className="modal-overlay" onClick={() => setEditingSalary(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="card-pad">
              <h3 style={{ margin:'0 0 4px' }}>NGO Salary Allocation</h3>
              <p style={{ fontSize:12, color:'var(--ink-soft)', margin:'0 0 12px' }}>
                Set the ₹ amount each NGO pays towards this employee's salary. Total must equal active salary ({formatSalary(activeSalary?.salary || 0)}).
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
                {salarySplitForm.map((p, i) => (
                  <div key={p.ngo_id || i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ flex:1, fontSize:13, fontWeight:500 }}>
                      {ngos.find(n => n.id === p.ngo_id)?.name || 'NGO'}
                    </span>
                    <span style={{ fontSize:12, color:'var(--ink-soft)' }}>₹</span>
                    <input type="number" min="0" value={p.portion}
                      onChange={e => setSalarySplitForm(f => f.map((x, j) => j === i ? { ...x, portion: e.target.value } : x))}
                      style={{ width:120, border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'6px 8px', fontSize:13, textAlign:'right' }}
                      placeholder="0" />
                  </div>
                ))}
              </div>
              <div style={{ fontSize:12, marginBottom:12, color:'var(--ink-soft)' }}>
                Total: ₹{salarySplitForm.reduce((s, x) => s + (parseFloat(x.portion) || 0), 0).toLocaleString('en-IN')}
                {' '}· Active salary: {formatSalary(activeSalary?.salary || 0)}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn btn-primary btn-sm" disabled={salarySaving}
                  onClick={async () => {
                    setSalarySaving(true);
                    try {
                      const allocs = salarySplitForm.filter(x => (parseFloat(x.portion) || 0) > 0)
                        .map(x => ({ ngo_id: x.ngo_id, salary_portion: parseFloat(x.portion) }));
                      await saveWorkerSalaryAlloc(worker.id, allocs, salaryAllocMonth);
                      const r = await fetchWorkerSalaryAlloc(worker.id, salaryAllocMonth);
                      setSalaryAllocs(r?.allocations || []);
                      setEditingSalary(false);
                    } catch (e) { setAllocMsg(e.message); }
                    setSalarySaving(false);
                  }}>
                  {salarySaving ? 'Saving...' : 'Save'}
                </button>
                <button className="btn btn-sm" onClick={() => setEditingSalary(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {holdModal && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(15,23,42,.45)', zIndex:200,
          display:'flex', alignItems:'center', justifyContent:'center',
        }} onClick={() => setHoldModal(false)}>
          <div style={{
            background:'#fff', borderRadius:14, width:'min(92vw,440px)',
            padding:'20px 22px', boxShadow:'0 20px 60px rgba(0,0,0,.25)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:4 }}>Hold Salary</div>
            <div style={{ fontSize:12, color:'var(--ink-soft)', marginBottom:14 }}>
              {data?.name || 'Worker'} · {effectiveMonthKey}
            </div>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--ink)', marginBottom:6 }}>
              Reason (optional)
            </div>
            <textarea
              rows={3} value={holdReason}
              onChange={e => setHoldReason(e.target.value)}
              placeholder="e.g. Bank details mismatch, verify & pay next month"
              style={{
                width:'100%', boxSizing:'border-box', padding:'8px 10px', borderRadius:8,
                border:'1px solid var(--line)', fontSize:13, resize:'vertical', fontFamily:'inherit',
              }} />
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
              <button className="btn btn-sm" onClick={() => { setHoldModal(false); setHoldReason(''); }}>Cancel</button>
              <button className="btn btn-sm" style={{ background:'var(--danger)', color:'#fff', border:'none' }}
                onClick={handlerHoldSalary} disabled={holdBusy}>
                {holdBusy ? 'Saving…' : 'Confirm Hold'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}


function ShiftSettings({ workerId, currentShift, onSave }) {
  const { updateWorker } = useHR()
  const [start, setStart] = useState(currentShift?.start || '')
  const [end, setEnd] = useState(currentShift?.end || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    setStart(currentShift?.start || '')
    setEnd(currentShift?.end || '')
  }, [currentShift?.start, currentShift?.end])

  const hasOverride = !!(currentShift?.start || currentShift?.end)
  const isCustom = currentShift?.start || currentShift?.end

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await updateWorker(workerId, { shift_start_time: start || null, shift_end_time: end || null })
      setMsg({ type: 'success', text: 'Shift settings saved' })
      onSave?.()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setStart('')
    setEnd('')
    setSaving(true)
    setMsg(null)
    try {
      await updateWorker(workerId, { shift_start_time: null, shift_end_time: null })
      setMsg({ type: 'success', text: 'Reset to default shift' })
      onSave?.()
    } catch (e) {
      setMsg({ type: 'error', text: e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div className="card-head"><h3>Shift Settings</h3></div>
      <div className="card-pad">
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: isCustom ? '#fefce8' : '#f3f4f6', border: '1px solid', borderColor: isCustom ? '#fde68a' : '#e5e7eb', fontSize: 13 }}>
          <strong>Current shift:</strong>{' '}
          {isCustom
            ? <><span style={{ color: '#92400e' }}>{currentShift?.start || '10:00'} – {currentShift?.end || '19:00'}</span> <span style={{ fontSize: 11, color: '#a16207' }}>(Custom override)</span></>
            : <span style={{ color: '#6b7280' }}>10:00 – 19:00 <span style={{ fontSize: 11 }}>(Default — no override set)</span></span>
          }
        </div>

        {msg && (
          <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12, background: msg.type === 'success' ? '#d1fae5' : '#fee2e2', color: msg.type === 'success' ? '#065f46' : '#991b1b' }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label className="field">
            <span>Override Start Time</span>
            <input type="time" value={start} onChange={e => setStart(e.target.value)}
              placeholder="10:00" />
          </label>
          <label className="field">
            <span>Override End Time</span>
            <input type="time" value={end} onChange={e => setEnd(e.target.value)}
              placeholder="19:00" />
          </label>
        </div>
        <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 4, marginBottom: 0 }}>
          Leave blank to use the default shift timing (10:00 – 19:00). The late calculation and half-day detection will adjust to these timings.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          {hasOverride && (
            <button className="btn btn-sm" onClick={reset} disabled={saving} style={{ color: 'var(--danger)' }}>
              Reset to Default
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="detail-field">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value || '\u2014'}</span>
    </div>
  );
}

function EditField({ label, value, onChange, type }) {
  return (
    <div className="detail-field">
      <span className="detail-label">{label}</span>
      <input type={type || 'text'} value={value} onChange={onChange}
        style={{ border:'1px solid var(--line)', borderRadius:'var(--radius-sm)', padding:'6px 10px', fontSize:13, width:'100%' }} />
    </div>
  );
}

function SideField({ label, value }) {
  return (
    <div className="side-field">
      <span className="side-label">{label}</span>
      <span className="side-value">{value}</span>
    </div>
  );
}

function SideFieldChk({ label, checked, onChange }) {
  return (
    <div className="side-field">
      <span className="side-label">{label}</span>
      <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
        <input type="checkbox" checked={checked} onChange={onChange} />
        {checked ? 'Active' : 'Inactive'}
      </label>
    </div>
  );
}

function DocLink({ url, label }) {
  return (
    <a className="doc-link" href={url} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

function StatusPill({ status }) {
  const s = (status || '').toLowerCase();
  const cls = s === 'present' || s === 'approved' ? 'pill-green'
    : s === 'late' ? 'pill-gold'
    : s === 'absent' || s === 'rejected' ? 'pill-danger'
    : s === 'pending' ? 'pill-gold'
    : s === 'leave' ? 'pill-gray'
    : 'pill-gray';
  return <span className={`pill ${cls}`}>{status}</span>;
}

function AttendanceChart({ records }) {
  const present = records.filter(r => r.status === 'present').length;
  const late = records.filter(r => r.status === 'late').length;
  const absent = records.filter(r => r.status === 'absent').length;
  const leave = records.filter(r => r.status === 'leave' || r.status === 'Leave').length;
  const total = present + late + absent + leave;
  if (!total) return null;

  const segments = [
    { label:'Present', count:present, color:'var(--sage)' },
    { label:'Late', count:late, color:'var(--gold)' },
    { label:'Absent', count:absent, color:'var(--clay)' },
    { label:'Leave', count:leave, color:'#8b5cf6' },
  ].filter(s => s.count > 0);

  const r = 40;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="att-chart">
      <svg width="140" height="140" viewBox="0 0 120 120">
        {segments.map((s, i) => {
          const pct = s.count / total;
          const dash = pct * circ;
          const segOffset = -offset;
          offset += dash;
          return (
            <circle key={s.label}
              cx="60" cy="60" r={r} fill="none"
              stroke={s.color} strokeWidth="16"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={segOffset}
              strokeLinecap="round"
              transform="rotate(-90 60 60)"
              style={{ transition:'stroke-dasharray 0.6s ease' }}
            />
          );
        })}
        <text x="60" y="54" textAnchor="middle" fill="var(--ink)"
          fontSize="22" fontWeight="700">{total}</text>
        <text x="60" y="70" textAnchor="middle" fill="var(--ink-soft)"
          fontSize="10">total</text>
      </svg>
      <div className="att-legend">
        {segments.map(s => (
          <div key={s.label} className="att-legend-item">
            <span className="att-dot" style={{ background:s.color }} />
            <span className="att-lbl">{s.label}</span>
            <span className="att-cnt">{s.count}</span>
            <span className="att-pct">{Math.round(s.count / total * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Box({ num, label, color, big }) {
  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      background: color + '15',
      border: '2px solid ' + color,
      borderRadius: 10,
      padding: big ? '10px 18px' : '8px 14px',
      minWidth: big ? 100 : 70,
    }}>
      <span style={{ fontSize: big ? 24 : 18, fontWeight:700, color, lineHeight:1.2 }}>{num}</span>
      <span style={{ fontSize:10, color:'var(--ink-soft)', textAlign:'center', whiteSpace:'pre-line', lineHeight:1.3 }}>{label}</span>
    </div>
  );
}

function Arrow() {
  return <span style={{ fontSize:20, color:'var(--ink-soft)', fontWeight:300 }}>→</span>;
}

function Equals() {
  return <span style={{ fontSize:20, color:'var(--ink-soft)', fontWeight:300 }}>=</span>;
}

function Times() {
  return <span style={{ fontSize:18, color:'var(--ink-soft)', fontWeight:300 }}>×</span>;
}

function SkeletonDetail({ onBack }) {
  return (
    <>
      <div className="sk" style={{ width:160, height:18, marginBottom:16, borderRadius:6 }} />
      <div className="detail-split">
        <div className="card detail-sidebar" style={{ padding:'24px 20px' }}>
          <div style={{ textAlign:'center' }}>
            <div className="sk" style={{ width:80, height:80, borderRadius:20, margin:'0 auto' }} />
            <div className="sk" style={{ width:'60%', height:16, margin:'12px auto 6px', borderRadius:6 }} />
            <div className="sk" style={{ width:'40%', height:12, margin:'0 auto', borderRadius:6 }} />
          </div>
          <div style={{ marginTop:20, display:'flex', flexDirection:'column', gap:12 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="sk" style={{ width:'100%', height:14, borderRadius:4 }} />
            ))}
          </div>
        </div>
        <div className="detail-main">
          <div className="sk" style={{ width:300, height:32, marginBottom:16, borderRadius:8 }} />
          <div className="card">
            <div className="card-head"><div className="sk" style={{ width:120, height:16, borderRadius:6 }} /></div>
            <div className="detail-grid">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="detail-field">
                  <div className="sk" style={{ width:'40%', height:10, marginBottom:4, borderRadius:4 }} />
                  <div className="sk" style={{ width:'70%', height:14, borderRadius:4 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
