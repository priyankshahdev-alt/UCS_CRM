import { useState, useEffect, useRef, useCallback } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { LayoutDashboard, Users, Gift, Ticket, MessageCircle, Coins } from 'lucide-react'
import { useUcs } from '../../store'
import { themes, applyTheme } from '../hr/theme'
import { getScheduled, getCallbacks } from './api/donors'
import { getMyDashboard } from './api/donors'
import { getMyTarget } from './api/target'
import { useRealtime } from '../../hooks/useRealtime'
import { onFroAction } from '../../lib/socket'
import { api, impersonateFRO, generateImpersonationCode, getFroWorkersForImpersonation, getFroWorkAsStations, releaseWorkAs, isImpersonating, startImpersonation, exitImpersonation } from '../../api/auth'
import { requestNotifPermission, showDesktopNotification } from '../../utils/desktopNotif'
import { toast } from '../../components/Toast'
import DispositionModal from './components/DispositionModal'
import CallTimer from './components/CallTimer'
import { CallProvider } from './CallContext'
import { API_BASE as apiBase } from '../../lib/apiBase'
import NotificationDrawer from '../../components/NotificationDrawer'
import SettingsDrawer from '../../components/SettingsDrawer'
import ToastContainer from '../../components/Toast'
import Dashboard from './pages/Dashboard'
import MyLeadsSuspense from './pages/MyLeadsSuspense'
import Donors from './pages/Donors'
import IncentiveInfo from './pages/IncentiveInfo'
import AkiBanner from '../../components/AkiBanner'
import SpecialIncentive from '../../components/SpecialIncentive'
import LeadChampionCelebration from '../../components/LeadChampionCelebration'
import NoticePopup from '../../components/NoticePopup'
import History from './pages/History'
import FroTickets from './pages/Tickets'
import FroSuspense from './pages/Suspense'
import { useIsMobile } from '../../hooks/useIsMobile'
import { istDateString } from './utils/time'
import teleWav from '../../assets/audio/tele.wav'
import followDueMp3 from '../../assets/audio/follow_due.mp3'
import callLessMp3 from '../../assets/audio/call_less.mp3'

const suspenseAlertAudio = new Audio(teleWav);
suspenseAlertAudio.preload = 'auto';
const followDueAudio = new Audio(followDueMp3);
const callLessAudio = new Audio(callLessMp3);
followDueAudio.preload = 'auto';
callLessAudio.preload = 'auto';
const SUSPENSE_RING_WINDOW_MS = 90 * 1000;
function playSuspenseAlert(title) {
  try {
    suspenseAlertAudio.currentTime = 0;
    const p = suspenseAlertAudio.play();
    if (p && p.then) p.catch(() => {});
  } catch {}
  toast(title || 'Suspense Alert', 'info');
}
function playFroAction(type, title) {
  const audio = type === 'fro_action_follow_up' ? followDueAudio : callLessAudio;
  try {
    audio.currentTime = 0;
    const p = audio.play();
    if (p && p.then) p.catch(() => {});
  } catch {}
  toast(title || 'FRO action', 'info');
}
let suspenseAudioUnlocked = false;
function warmupSuspenseAudio() {
  if (suspenseAudioUnlocked) return;
    suspenseAudioUnlocked = true;
    try {
    suspenseAlertAudio.volume = 0;
    suspenseAlertAudio.muted = true;
    const p = suspenseAlertAudio.play();
    if (p && p.then) p.then(() => {
      suspenseAlertAudio.pause();
      suspenseAlertAudio.currentTime = 0;
      suspenseAlertAudio.muted = false;
      suspenseAlertAudio.volume = 1;
    }).catch(() => {});
    for (const audio of [followDueAudio, callLessAudio]) {
      audio.volume = 0;
      audio.muted = true;
      const p = audio.play();
      if (p && p.then) p.then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        audio.volume = 1;
      }).catch(() => {});
    }
  } catch {}
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', warmupSuspenseAudio, { once: false });
  window.addEventListener('keydown', warmupSuspenseAudio, { once: false });
  window.addEventListener('touchstart', warmupSuspenseAudio, { once: false });
}

const NAV_BASE = [
  { id: 'dashboard', path: '/fro/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'my-leads', path: '/fro/my-leads', label: 'My Leads', Icon: Users },
  { id: 'donors', path: '/fro/donors', label: 'Donors', Icon: Gift },
  { id: 'tickets', path: '/fro/tickets', label: 'Raise Ticket', Icon: Ticket },
]

const INBOX_SHORT = { bsct: 'BSCT', aflf: 'AFLF', mann: 'MANN' }

const currency = n => n != null ? '\u20B9' + Number(n).toLocaleString('en-IN') : '\u2014'

function callFmt(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function loadTodayStats() {
  try {
    const raw = localStorage.getItem('fro_call_stats');
    if (!raw) return null;
    const data = JSON.parse(raw);
    const today = istDateString();
    if (data.date !== today) return null;
    return data;
  } catch { return null; }
}

function WhatsAppComingSoon() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: 'var(--ink-soft)' }}>
      <MessageCircle size={40} strokeWidth={1.5} style={{ opacity: 0.4 }} />
      <div style={{ fontSize: 14, fontWeight: 700 }}>Inbox coming soon</div>
    </div>
  );
}

function Sidebar({ open, onClose, waUnreadCounts }) {
  const location = useLocation()
  const nav = [...NAV_BASE]
  const waAgents = JSON.parse(localStorage.getItem('wa_agents') || '[]')
  if (waAgents.length === 1) {
    nav.push({ id: 'whatsapp-chat', path: `/fro/whatsapp-chat?project=${waAgents[0].project}`, label: `Inbox ${INBOX_SHORT[waAgents[0].project] || waAgents[0].project}`, Icon: MessageCircle })
  } else if (waAgents.length > 1) {
    waAgents.forEach(a => {
      nav.push({ id: `whatsapp-${a.project}`, path: `/fro/whatsapp-chat?project=${a.project}`, label: `Inbox ${INBOX_SHORT[a.project] || a.project}`, Icon: MessageCircle })
    })
  } else {
    nav.push({ id: 'whatsapp-chat', path: '/fro/whatsapp-chat', label: 'Inbox', Icon: MessageCircle })
  }
  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">U</div>
          <div><h1>UFS</h1><span>FRO Panel</span></div>
          <button className="sidebar-close" onClick={onClose} aria-label="Close menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <nav className="sidebar-nav">
          {nav.map(n => {
            const waDisabled = n.id.startsWith('whatsapp');
            return (
            <NavLink key={n.id} to={n.path} end
              className={() => `snav-item ${location.pathname + location.search === n.path ? 'active' : location.pathname === n.path && !n.path.includes('?') ? 'active' : ''}`}
              onClick={(e) => {
                if (waDisabled) {
                  e.preventDefault();
                  toast('Inbox coming soon', 'info');
                }
                onClose?.();
              }}
              style={waDisabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
            <n.Icon size={18} strokeWidth={2} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{n.label}</span>
              {n.id.startsWith('whatsapp') && waUnreadCounts?.[n.id] > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, background: '#25D366', color: '#fff', borderRadius: 10, padding: '1px 7px', lineHeight: '16px', minWidth: 18, textAlign: 'center' }}>
                  {waUnreadCounts[n.id] > 9 ? '9+' : waUnreadCounts[n.id]}
                </span>
              )}
              {n.id === 'whatsapp-chat' && waAgents.length === 1 && waUnreadCounts?.[`whatsapp-${waAgents[0]?.project}`] > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, background: '#25D366', color: '#fff', borderRadius: 10, padding: '1px 7px', lineHeight: '16px', minWidth: 18, textAlign: 'center' }}>
                  {waUnreadCounts[`whatsapp-${waAgents[0]?.project}`] > 9 ? '9+' : waUnreadCounts[`whatsapp-${waAgents[0]?.project}`]}
                </span>
              )}
              {n.id === 'whatsapp-chat' && waUnreadCounts?.total > 0 && !waAgents.length && (
                <span style={{ fontSize: 10, fontWeight: 700, background: '#25D366', color: '#fff', borderRadius: 10, padding: '1px 7px', lineHeight: '16px', minWidth: 18, textAlign: 'center' }}>
                  {waUnreadCounts.total > 9 ? '9+' : waUnreadCounts.total}
                </span>
              )}
            </span>
          </NavLink>
            );
          })}
        </nav>
      </aside>
    </>
  )
}

export default function FROPanel() {
  const { user, logout } = useUcs()
  const location = useLocation()
  const isMobile = useIsMobile()
  const [showMenu, setShowMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [waUnreadCounts, setWaUnreadCounts] = useState({ total: 0 })
  const [themeName, setThemeName] = useState(() => localStorage.getItem('fro_theme') || 'sky')
  const menuRef = useRef(null)
  const workAsRef = useRef(null)

  const [showWorkAs, setShowWorkAs] = useState(false)
  const [froList, setFroList] = useState([])
  const [workAsLoading, setWorkAsLoading] = useState(false)
  const [workAsSearch, setWorkAsSearch] = useState('')
  const [pendingTarget, setPendingTarget] = useState(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeSubmitting, setCodeSubmitting] = useState(false)
  const [generatingCode, setGeneratingCode] = useState(false)
  const [codeGenerated, setCodeGenerated] = useState(false)
  // Station-scoped work-as: modal phase ('stations' → 'code') and the picker.
  const [waPhase, setWaPhase] = useState('stations')
  const [waStations, setWaStations] = useState([])
  const [waStationsLoading, setWaStationsLoading] = useState(false)
  const [pickedStations, setPickedStations] = useState(() => new Set())
  const impersonating = isImpersonating()

  const openWorkAs = async () => {
    const opening = !showWorkAs
    setShowWorkAs(!showWorkAs)
    if (!opening) return
    setWorkAsSearch('')
    // Refetch on every open so newly added FROs show up without a reload;
    // the previous list stays visible while loading.
    setWorkAsLoading(true)
    try {
      const res = await getFroWorkersForImpersonation()
      setFroList(res?.workers || [])
    } catch (e) { console.error('Error:', e.message); }
    finally { setWorkAsLoading(false) }
  }

  const stationKeyOf = (s) => `${s?.ngo_id ?? ''}|${String(s?.station ?? '').trim()}`

  const loadWorkAsStations = async (worker) => {
    setWaStations([])
    setWaStationsLoading(true)
    try {
      const res = await getFroWorkAsStations(worker.id)
      const list = res?.stations || []
      setWaStations(list)
      // Pre-tick our own still-active claims so Continue keeps them.
      setPickedStations(new Set(list.filter(s => s.mine).map(stationKeyOf)))
    } catch (e) {
      console.error('Error:', e.message)
      toast(e.message || 'Could not load stations')
      setPendingTarget(null)
    } finally { setWaStationsLoading(false) }
  }

  const pickImpersonateTarget = (worker) => {
    setShowWorkAs(false)
    setPendingTarget(worker)
    setCodeInput('')
    setCodeGenerated(false)
    setWaPhase('stations')
    setPickedStations(new Set())
    loadWorkAsStations(worker)
  }

  const togglePickStation = (s) => {
    setPickedStations(prev => {
      const next = new Set(prev)
      const k = stationKeyOf(s)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const selectAllPickableStations = () =>
    setPickedStations(new Set(waStations.filter(s => s.available || s.mine).map(stationKeyOf)))

  const pickedPairs = () =>
    waStations.filter(s => pickedStations.has(stationKeyOf(s))).map(s => ({ ngo_id: s.ngo_id, station: s.station }))

  const generateCodeForSwitch = async () => {
    setGeneratingCode(true)
    try {
      await generateImpersonationCode()
      setCodeGenerated(true)
      setCodeInput('')
    } catch (e) {
      console.error('Error:', e.message)
      alert(e.message || 'Could not generate code')
    } finally {
      setGeneratingCode(false)
    }
  }

  const filteredFroList = froList.filter(w => !workAsSearch || (w.name || '').toLowerCase().includes(workAsSearch.toLowerCase()))

  const doImpersonate = async () => {
    if (!pendingTarget) return
    setCodeSubmitting(true)
    try {
      const res = await impersonateFRO(pendingTarget.id, codeInput.trim(), undefined, pickedPairs())
      startImpersonation(res.token, res.user)
      setPendingTarget(null)
      setCodeInput('')
      setCodeGenerated(false)
      window.location.reload()
    } catch (e) {
      console.error('Error:', e.message)
      toast(e.message || 'Could not switch FRO')
      // Someone else grabbed a station between pick and switch — back to the
      // picker with fresh availability so they can choose free stations.
      if (/already being worked/.test(e.message || '') && pendingTarget) {
        setWaPhase('stations')
        loadWorkAsStations(pendingTarget)
      }
    } finally {
      setCodeSubmitting(false)
    }
  }

  const doExitImpersonation = async () => {
    // Free our claimed stations server-side before restoring the own session.
    try { await releaseWorkAs() } catch (e) { console.error('Error:', e.message) }
    exitImpersonation()
    window.location.reload()
  }

  useEffect(() => {
    if (themes[themeName]) {
      applyTheme(themes[themeName], '.panel-fro')
      const t = themes[themeName]
      const el = document.querySelector('.panel-fro') || document.documentElement
      el.style.setProperty('--bg', t.sand); el.style.setProperty('--card-bg', t.paper); el.style.setProperty('--sage-light', t['sage-soft'])
    }
    localStorage.setItem('fro_theme', themeName)
  }, [themeName])

  useEffect(() => { setSidebarOpen(false) }, [location.pathname])

  const [modalDonor, setModalDonor] = useState(null);
  const [modalNotifId, setModalNotifId] = useState(null);
  const [rows, setRows] = useState([]);
  const [refetch, setRefetch] = useState(0);
  const [showNotifList, setShowNotifList] = useState(false);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [verifiedItems, setVerifiedItems] = useState([]);
  const [allVerified, setAllVerified] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsData, setStatsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [showAki, setShowAki] = useState(false);
  const [akiSlabs, setAkiSlabs] = useState(null);
  const [akiLoading, setAkiLoading] = useState(false);
  let _initSeenNotifs = []; try { _initSeenNotifs = JSON.parse(localStorage.getItem('fro_seen_notifs') || '[]'); } catch { /* corrupted */ }
  const seenNotifIds = useRef(new Set(_initSeenNotifs));
  let _initRungAlerts = []; try { _initRungAlerts = JSON.parse(localStorage.getItem('fro_rung_suspense_alerts') || '[]'); } catch { /* corrupted */ }
  const rungAlertIds = useRef(new Set(_initRungAlerts));
  const notifRef = useRef(null);
  const poppedIds = useRef(new Set());
  const snoozedUntil = useRef({});

  const markRead = async (notifId) => {
    try { await api(`/notifications/${notifId}/read`, { method: 'PUT', _prefix: 'ucs' }); }
    catch (e) { console.error('Error:', e.message); }
  };

  const openAki = async () => {
    setShowAki(true);
    if (!akiSlabs) {
      setAkiLoading(true);
      try {
        const data = await api('/incentive/aki-config');
        setAkiSlabs(data?.slabs || {});
      } catch (e) {
        console.error('Error:', e.message);
      } finally {
        setAkiLoading(false);
      }
    }
  };

  const handlePopDone = async () => {
    if (modalDonor?.id) poppedIds.current.add(modalDonor.id);
    if (modalNotifId) await markRead(modalNotifId);
    setModalNotifId(null);
    setModalDonor(null);
    setRefetch(n => n + 1);
    loadNotifications();
    loadReminders();
  };

  const handleSnooze = () => {
    if (modalDonor?.id) {
      snoozedUntil.current[modalDonor.id] = Date.now() + 2 * 60 * 1000;
      poppedIds.current.delete(modalDonor.id);
    }
    setModalNotifId(null);
    setModalDonor(null);
    toast('Snoozed — will pop up again in 2 min', 'info');
  };

  const markRungAlert = (id) => {
    rungAlertIds.current.add(id);
    try { localStorage.setItem('fro_rung_suspense_alerts', JSON.stringify([...rungAlertIds.current])); } catch {}
  };

  const ringSuspenseAlert = (n) => {
    if (!n || rungAlertIds.current.has(n.id)) return;
    markRungAlert(n.id);
    playSuspenseAlert(n.title);
  };

  const loadNotifications = () => {
    const workerId = user?.id;
    if (!workerId) return;
    const now = Date.now();
    api(`/notifications/${workerId}`, { _prefix: 'ucs' })
      .then(data => {
        const allNotifs = data || [];
        allNotifs
          .filter(n => n.type === 'suspense_alert')
          .forEach(n => {
            const t = n.sent_at ? new Date(n.sent_at).getTime() : 0;
            if (now - t <= SUSPENSE_RING_WINDOW_MS) ringSuspenseAlert(n);
          });
        const verified = allNotifs.filter(n => n.type === 'lead_verified' && !n.read_at);
        const verifiedSlice = verified.slice(0, 20);
        verifiedSlice.forEach(n => {
          if (!seenNotifIds.current.has(n.id)) {
            seenNotifIds.current.add(n.id);
            localStorage.setItem('fro_seen_notifs', JSON.stringify([...seenNotifIds.current]));
            showDesktopNotification(n.title, n.body);
          }
        });
        allNotifs
          .filter(n => n.type === 'new_audit' && !n.read_at)
          .slice(0, 20)
          .forEach(n => {
            if (!seenNotifIds.current.has(n.id)) {
              seenNotifIds.current.add(n.id);
              localStorage.setItem('fro_seen_notifs', JSON.stringify([...seenNotifIds.current]));
              showDesktopNotification(n.title, n.body, '/fro/suspense');
              toast(`${n.title}: ${n.body}`, 'info');
            }
          });
        allNotifs
          .filter(n => n.type === 'idle_alert' && !n.read_at)
          .slice(0, 20)
          .forEach(n => {
            if (!seenNotifIds.current.has(n.id)) {
              seenNotifIds.current.add(n.id);
              localStorage.setItem('fro_seen_notifs', JSON.stringify([...seenNotifIds.current]));
              showDesktopNotification(n.title, n.body);
              toast(`${n.title}: ${n.body}`, 'error');
            }
          });
        setAllVerified(verified);
        setVerifiedItems(verifiedSlice);
        setVerifiedCount(verified.length);
      })
      .catch((err) => { console.error('Error:', err.message); });
  };
  useEffect(() => {
    loadNotifications();
    requestNotifPermission();
    const poll = setInterval(loadNotifications, 8000);
    return () => clearInterval(poll);
  }, [user?.id]);

  useEffect(() => onFroAction((action) => {
    if (action?.type === 'fro_action_follow_up' || action?.type === 'fro_action_less_calls') {
      playFroAction(action.type, action.title);
    }
  }), []);

  useRealtime('notification_log', {
    filter: `worker_id=eq.${user?.id}`,
    onInsert: (row) => {
      if (row?.type === 'suspense_alert') {
        ringSuspenseAlert(row);
      }
      // NGO admin clicked "Notify" — surface instantly (deduped via seenNotifIds)
      if (row?.type === 'idle_alert' && row?.id && !seenNotifIds.current.has(row.id)) {
        seenNotifIds.current.add(row.id);
        localStorage.setItem('fro_seen_notifs', JSON.stringify([...seenNotifIds.current]));
        showDesktopNotification(row.title, row.body);
        toast(`${row.title}: ${row.body}`, 'error');
      }
      loadNotifications();
    },
    enabled: !!user?.id,
  });

  const refreshWaUnread = useCallback(async () => {
    try {
      const token = localStorage.getItem('ucs_token')
      if (!token) return

      // Try auto-login first if no agents stored
      const storedAgents = JSON.parse(localStorage.getItem('wa_agents') || '[]')
      if (storedAgents.length === 0 && user?.id) {
        try {
          const loginRes = await fetch(`${apiBase}/fro/whatsapp/auto-login`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (loginRes.ok) {
            const loginData = await loginRes.json()
            const sessionList = loginData.agents || loginData.sessions || []
            if (sessionList.length) {
              const agents = sessionList.map(s => ({
                agentUserId: s.agentId,
                accountName: s.account?.name,
                project: s.project,
                whatsappUserId: s.account?.id,
                token: s.token,
              }))
              localStorage.setItem('wa_agents', JSON.stringify(agents))
            }
          }
        } catch { /* silent */ }
      }

      // Fetch unread counts — use the FRO JWT for all WhatsApp API calls
      // since agent tokens are session tokens, not JWTs compatible with the
      // authenticate middleware.
      const counts = { total: 0 }
      try {
        const res = await fetch(`${apiBase}/fro/whatsapp/conversations/unread-count`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          counts.total = data?.count || 0
        }
      } catch { /* skip */ }
      setWaUnreadCounts(counts)
    } catch (e) { console.error('Error:', e.message); }
  }, [user?.id])
  useEffect(() => { refreshWaUnread() }, [refreshWaUnread])

  useRealtime('messages', {
    event: '*',
    onInsert: refreshWaUnread,
    onUpdate: refreshWaUnread,
  })

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifList(false)
      if (workAsRef.current && !workAsRef.current.contains(e.target)) setShowWorkAs(false)
    }
    if (showMenu || showNotifList || showWorkAs) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu, showNotifList, showWorkAs])

  const loadReminders = () => {
    Promise.all([getScheduled(), getCallbacks()]).then(([scheduled, callbacks]) => {
      const todayStr = istDateString();
      const items = []; const seen = new Set();
      (scheduled || []).forEach(d => {
        if (d.scheduled_at && istDateString(d.scheduled_at) !== todayStr && !seen.has(d.id)) {
          seen.add(d.id); items.push({ id: d.id, ngo_id: d.ngo_id, donor_name: d.donor_name, donor_mobile: d.donor_mobile, scheduled_at: d.scheduled_at, assignment_id: d.assignment_id, type: 'scheduled' });
        }
      });
      (callbacks || []).forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); items.push({ id: d.id, ngo_id: d.ngo_id, donor_name: d.donor_name, donor_mobile: d.donor_mobile, scheduled_at: d.scheduled_at || null, assignment_id: d.assignment_id, type: 'callback' }); } });
      (scheduled || []).forEach(d => {
        if (d.scheduled_at && istDateString(d.scheduled_at) === todayStr && !seen.has(d.id)) {
          seen.add(d.id); items.push({ id: d.id, ngo_id: d.ngo_id, donor_name: d.donor_name, donor_mobile: d.donor_mobile, scheduled_at: d.scheduled_at, assignment_id: d.assignment_id, type: 'callback' });
        }
      });
      setRows(items);
    }).catch((err) => { console.error('Error:', err.message); });
  };
  useEffect(() => { loadReminders(); }, [refetch]);

  useRealtime('fro_donor_logs', {
    event: '*',
    onInsert: loadReminders,
    onUpdate: loadReminders,
  })
  useRealtime('fro_assignments', {
    event: '*',
    onInsert: loadReminders,
    onUpdate: loadReminders,
  })

  const dedupedRows = rows.filter((r, i, a) => i === a.findIndex(x => x.id === r.id));
  const dueItems = dedupedRows.filter(r => r.scheduled_at && new Date(r.scheduled_at) <= new Date());
  const dueCount = dueItems.length;

  const meta = NAV_BASE.find(n => location.pathname === n.path)
  const userName = user?.name || 'User'
  const initials = userName.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  const drawerSections = [
    { label: 'Verified Leads', type: 'verified', items: allVerified },
    { label: 'Follow Up / Callback', type: 'schedule', items: dueItems },
  ];

  const handleDrawerItemClick = (item, section) => {
    setDrawerOpen(false);
    setModalDonor(item);
  };

  return (
    <CallProvider userId={user?.id}>
    <div className="app">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} waUnreadCounts={waUnreadCounts} />
      <div className="main">
        <header className="topbar">
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button className="hamburger" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu">
              {sidebarOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
              )}
            </button>
            <div className="topbar-label">
            <div className="eyebrow">FRO</div>
            <h2>{meta?.label || 'Dashboard'}</h2>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <CallTimer />
            <div onClick={openAki} title="Aaj Ka Incentive (AKI)" style={{ cursor: 'pointer', padding: 6, borderRadius: 8, transition: 'background .15s' }}>
              <Coins size={20} strokeWidth={2} color="var(--ink-soft)" style={{ color: '#B45309' }} />
            </div>
            <div style={{ position:'relative' }}>
              <div onClick={async () => { setShowStats(true); setShowTarget(false); setStatsLoading(true); try { const [d, t] = await Promise.all([getMyDashboard().catch((err) => { console.error('Error:', err.message); }), getMyTarget().catch((err) => { console.error('Error:', err.message); })]);             setStatsData({ dash: d, target: t }); } catch (e) { console.error('Error:', e.message); } finally { setStatsLoading(false); } }} style={{ cursor:'pointer', padding:6, borderRadius:8, transition:'background .15s' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="2" strokeLinecap="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
            </div>
            <div ref={workAsRef} style={{ position: 'relative' }}>
              <div onClick={openWorkAs} title={impersonating ? `Acting FRO: ${user?.imposter_name || userName}` : 'Acting FRO'} style={{ cursor: 'pointer', padding: 6, borderRadius: 8, transition: 'background .15s', background: impersonating ? 'var(--sage-soft, rgba(22,163,74,.15))' : undefined }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={impersonating ? 'var(--sage)' : 'var(--ink-soft)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M16 8h.01"/><path d="M8 12h8"/><path d="M8 8h.01"/><path d="M16 12h.01"/></svg>
              </div>
              {showWorkAs && (
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 240, background: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 6, zIndex: 60 }}>
                  <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: .4 }}>Acting FRO</div>
                  <input
                    value={workAsSearch}
                    onChange={e => setWorkAsSearch(e.target.value)}
                    placeholder="Search FRO…"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', marginBottom: 4, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-soft, #f1f5f9)', color: 'var(--ink)', fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
                  />
                  {workAsLoading && <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-soft)' }}>Loading…</div>}
                  {!workAsLoading && (
                    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                      {filteredFroList.map(w => {
                        const isAbsconded = String(w.employment_status || '').toLowerCase().trim() === 'absconded'
                        const isInactive = w.is_active === false || w.employment_status === 'terminated'
                        return (
                        <div key={w.id} onClick={() => { if (w.id !== user?.id) pickImpersonateTarget(w); }} style={{ cursor: 'pointer', padding: '7px 10px', borderRadius: 8, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, background: w.id === user?.id ? 'var(--bg-soft, #f1f5f9)' : undefined, color: 'var(--ink)' }}>
                          <span style={{ fontWeight: 600 }}>{w.name}</span>
                          {isAbsconded
                            ? <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.4px', color: '#991b1b', background: '#fee2e2', borderRadius: 6, padding: '1px 7px' }}>ABS</span>
                            : isInactive && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '.4px', color: '#b45309', background: '#fef3c7', borderRadius: 6, padding: '1px 7px' }}>INACTIVE</span>}
                          {w.id === user?.id && <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-soft)' }}>You</span>}
                        </div>
                        )
                      })}
                      {filteredFroList.length === 0 && (
                        <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-soft)' }}>{froList.length === 0 ? 'No other FROs available' : 'No matching FROs'}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="topbar-user" ref={menuRef} onClick={() => setShowMenu(!showMenu)}>
              <div className="avatar">{initials}</div>
              {showMenu && (
                <div className="user-menu">
                  <div className="user-menu-item" style={{flexDirection:'column', alignItems:'flex-start', gap:2, cursor:'default'}}>
                    <div style={{fontWeight:600, fontSize:13}}>{userName}</div>
                    <div style={{fontSize:11, color:'var(--ink-soft)'}}>{impersonating && user?.imposter_name ? `OWNER: ${userName} · ACTING: ${user.imposter_name}` : 'FRO'}</div>
                  </div>
                  <div className="user-menu-divider" />
                  <div className="user-menu-item" onClick={() => { setShowMenu(false); setShowSettings(true); }} style={{cursor:'pointer'}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    Settings
                  </div>
                  <div className="user-menu-divider" />
                  <button className="user-menu-item" onClick={() => { setShowMenu(false); logout() }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
          <SettingsDrawer
            open={showSettings}
            onClose={() => setShowSettings(false)}
            themes={themes}
            themeName={themeName}
             onThemeChange={(key) => setThemeName(key)}
          />
        </header>
        {impersonating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: 'rgba(22,163,74,.12)', borderBottom: '1px solid var(--line)', fontSize: 12.5, color: 'var(--ink)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--sage)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>
            <span>OWNER: <b>{userName}</b> · ACTING FRO: <b>{user?.imposter_name || 'you'}</b>{Array.isArray(user?.act_stations) && user.act_stations.length > 0 && <> · Stations: <b>{[...new Set(user.act_stations.map(s => s.station))].join(', ')}</b></>} · Credit goes to <b>{user?.imposter_name || 'you'}</b></span>
            <button className="btn btn-sm" onClick={doExitImpersonation} style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 12px', background: 'var(--sage)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Exit Acting FRO</button>
          </div>
        )}
        {pendingTarget && (
          <div className="modal-overlay" onClick={() => setPendingTarget(null)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380, padding: 22, borderRadius: 'var(--radius)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                Acting FRO: {pendingTarget.name}
              </div>
              {waPhase === 'stations' ? (
                <>
                  {String(pendingTarget?.employment_status || '').toLowerCase().trim() === 'absconded' && (
                    <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 11, lineHeight: 1.4 }}>
                      ⚠ Absconded FRO — covering their stations. Donor ownership stays with {pendingTarget.name}; collection credit goes to you.
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 12 }}>
                    Select which stations you want to work on. Taken stations stay with their current operator.
                  </div>
                  {waStationsLoading && <div style={{ padding: '14px 0', fontSize: 12, color: 'var(--ink-soft)' }}>Loading stations…</div>}
                  {!waStationsLoading && waStations.length === 0 && (
                    <div style={{ padding: '10px 0', fontSize: 12, color: '#b91c1c' }}>No stations assigned to this FRO.</div>
                  )}
                  {!waStationsLoading && waStations.length > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <button onClick={selectAllPickableStations} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>Select all</button>
                        <button onClick={() => setPickedStations(new Set())} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer' }}>Clear</button>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-soft)' }}>{pickedStations.size}/{waStations.length}</span>
                      </div>
                      <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {waStations.map(s => {
                          const k = stationKeyOf(s)
                          const locked = !s.available && !s.mine
                          const checked = pickedStations.has(k)
                          return (
                            <div key={k} onClick={() => { if (!locked) togglePickStation(s) }}
                              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 8, border: checked ? '1px solid var(--sage)' : '1px solid var(--line)', background: locked ? 'rgba(148,163,184,.08)' : checked ? 'rgba(22,163,74,.07)' : 'transparent', cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? .75 : 1 }}>
                              <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', background: checked ? 'var(--sage)' : 'transparent', border: checked ? 'none' : '1.5px solid var(--line)' }}>{checked ? '✓' : ''}</span>
                              <span style={{ fontWeight: 700, fontSize: 12.5, color: 'var(--ink)' }}>{s.station}</span>
                              {s.ngo_name && <span style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{s.ngo_name}</span>}
                              <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {locked
                                  ? <span style={{ color: '#b45309', background: '#fef3c7', borderRadius: 6, padding: '2px 7px' }}>with {s.taken_by}</span>
                                  : s.mine && <span style={{ color: 'var(--sage)' }}>yours</span>}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                        <button className="btn" onClick={() => setPendingTarget(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
                        <button className="btn" onClick={() => setWaPhase('code')} disabled={pickedStations.size === 0}
                          style={{ flex: 1, justifyContent: 'center', background: pickedStations.size === 0 ? '#d1d5db' : 'var(--sage)', color: pickedStations.size === 0 ? '#9ca3af' : '#fff', cursor: pickedStations.size === 0 ? 'not-allowed' : 'pointer' }}>
                          Continue
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  {String(pendingTarget?.employment_status || '').toLowerCase().trim() === 'absconded' && (
                    <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 11, lineHeight: 1.4 }}>
                      ⚠ Absconded FRO — covering their stations. Donor ownership stays with {pendingTarget.name}; collection credit goes to you.
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 16 }}>
                    Stations: <b style={{ color: 'var(--ink)' }}>{[...new Set(pickedPairs().map(p => p.station))].join(', ') || '—'}</b>{' '}
                    <span onClick={() => setWaPhase('stations')} style={{ color: 'var(--sage)', cursor: 'pointer', textDecoration: 'underline' }}>(change)</span>
                    {codeGenerated
                      ? ' · Code generated! Ask your admin for the code and enter it below to switch.'
                      : ' · Generate a code to authorize switching. Your admin will share the code with you.'}
                  </div>
                  {!codeGenerated && (
                    <button
                      className="btn"
                      onClick={generateCodeForSwitch}
                      disabled={generatingCode}
                      style={{ width: '100%', justifyContent: 'center', background: 'var(--sage)', color: '#fff' }}
                    >
                      {generatingCode ? 'Generating…' : '+ Generate code'}
                    </button>
                  )}
                  <input
                    value={codeInput}
                    onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    onKeyDown={e => { if (e.key === 'Enter' && codeInput.length === 4) doImpersonate(); }}
                    placeholder="••••"
                    inputMode="numeric"
                    style={{ width: '100%', textAlign: 'center', fontSize: 24, fontWeight: 700, letterSpacing: 10, padding: '9px 0', borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--card-bg)', color: 'var(--ink)', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box', marginTop: 14 }}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                    <button className="btn" onClick={() => setWaPhase('stations')} style={{ flex: 1, justifyContent: 'center' }}>Back</button>
                    <button
                      className="btn"
                      onClick={doImpersonate}
                      disabled={codeInput.length !== 4 || codeSubmitting}
                      style={{ flex: 1, justifyContent: 'center', background: 'var(--sage)', color: '#fff' }}
                    >
                      {codeSubmitting ? 'Switching…' : 'Switch'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {showStats && (
            <div className="modal-overlay" onClick={() => setShowStats(false)}>
              <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--card-bg)' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{showTarget ? 'Monthly Target' : "Today's Activity"}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>{showTarget ? 'Your collection progress' : 'Your calling stats for today'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {showTarget && <button className="btn btn-sm" onClick={() => setShowTarget(false)} style={{ fontSize: 11, padding: '4px 10px' }}>← Stats</button>}
                    {!showTarget && <button className="btn btn-sm" onClick={() => setShowTarget(true)} style={{ fontSize: 11, padding: '4px 10px' }}>Target →</button>}
                    <button className="btn btn-sm btn-icon" onClick={() => setShowStats(false)} style={{ padding: 4 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  </div>
                </div>

                <div style={{ padding: '20px 22px', background: 'var(--bg)' }}>
                  {!showTarget ? (() => {
                    const ts = loadTodayStats();
                    const totalProd = (ts?.totalSeconds || 0) + (ts?.idleSeconds || 0);
                    if (!ts || (ts.calls === 0 && ts.skippedDonors === 0 && ts.breakSeconds === 0 && ts.idleSeconds === 0)) {
                      return (
                        <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)' }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" opacity=".4"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 12 }}>No activity yet today</div>
                          <div style={{ fontSize: 12, color: 'var(--ink-soft)', opacity: .6, marginTop: 4 }}>Start calling to see your stats here</div>
                        </div>
                      );
                    }
                    const pct = Math.round((ts.totalSeconds / (totalProd || 1)) * 100);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div className="fro-stat-grid-3" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }}>
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '16px 18px', boxShadow: 'var(--shadow)' }}>
                            <div style={{ fontSize: 28, fontWeight: 800, color: '#16a34a', lineHeight: 1.1 }}>{ts.calls}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Calls</div>
                          </div>
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '16px 18px', boxShadow: 'var(--shadow)' }}>
                            <div style={{ fontSize: 28, fontWeight: 800, color: '#16a34a', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{callFmt(ts.totalSeconds)}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Talk Time</div>
                          </div>
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '16px 18px', boxShadow: 'var(--shadow)' }}>
                            <div style={{ fontSize: 28, fontWeight: 800, color: '#16a34a', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{callFmt(Math.round(ts.totalSeconds / (ts.calls || 1)))}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Avg Call</div>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: '#d97706' }}>{ts.skippedDonors}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>Skipped</div>
                            </div>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" opacity=".5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          </div>
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{callFmt(ts.idleSeconds)}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>Idle</div>
                            </div>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" opacity=".5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          </div>
                        </div>

                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', boxShadow: 'var(--shadow)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: ts.breakSeconds > 3600 ? '#fef2f2' : '#fefce8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ts.breakSeconds > 3600 ? '#ef4444' : '#d97706', fontSize: 18 }}>☕</div>
                            <div>
                              <div style={{ fontSize: 20, fontWeight: 700, color: ts.breakSeconds > 3600 ? '#ef4444' : '#d97706', fontVariantNumeric: 'tabular-nums' }}>{callFmt(ts.breakSeconds)}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>{ts.breakCount || 0} breaks</div>
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 20, fontWeight: 700, color: pct > 50 ? '#16a34a' : '#d97706' }}>{pct}%</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>Productivity</div>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                    statsLoading ? (
                      <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)' }}>
                        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Loading...</div>
                      </div>
                    ) : statsData?.target ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 10 }}>
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '16px 18px', boxShadow: 'var(--shadow)', textAlign: 'center' }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#8b5cf6' }}>{'\u20B9' + Number(statsData.target.target || 0).toLocaleString('en-IN')}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Target</div>
                          </div>
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '16px 18px', boxShadow: 'var(--shadow)', textAlign: 'center' }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{'\u20B9' + Number(statsData.target.collected || 0).toLocaleString('en-IN')}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Collected</div>
                          </div>
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '16px 18px', boxShadow: 'var(--shadow)', textAlign: 'center' }}>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{'\u20B9' + Math.max(0, (statsData.target.target || 0) - (statsData.target.collected || 0)).toLocaleString('en-IN')}</div>
                            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 2 }}>Remaining</div>
                          </div>
                        </div>

                        {statsData.target.target > 0 && (
                          <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', boxShadow: 'var(--shadow)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6 }}>
                              <span>Progress</span>
                              <span>{Math.min(100, Math.round(((statsData.target.collected || 0) / statsData.target.target) * 100))}%</span>
                            </div>
                            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', borderRadius: 3, width: Math.min(100, ((statsData.target.collected || 0) / statsData.target.target) * 100) + '%', background: 'linear-gradient(90deg, #8b5cf6, #16a34a)', transition: 'width .5s ease' }} />
                            </div>
                          </div>
                        )}

                        {statsData.dash && (
                          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                            {[
                              { label: 'Connected (M)', value: statsData.dash.monthly_connected, color: '#3b82f6' },
                              { label: 'Connected (D)', value: statsData.dash.daily_connected, color: '#8b5cf6' },
                              { label: 'Verified', value: '\u20B9' + Number(statsData.dash.verified_month_amount || 0).toLocaleString('en-IN'), color: '#16a34a' },
                              { label: 'Unverified', value: '\u20B9' + Number(statsData.dash.unverified_month_amount || 0).toLocaleString('en-IN'), color: '#ef4444' },
                              { label: 'Active Donors', value: statsData.dash.active_donors || 0, color: '#5B6B4E' },
                              { label: 'Total', value: '\u20B9' + Number(statsData.dash.total_donations || 0).toLocaleString('en-IN'), color: '#B5603A' },
                            ].map(s => (
                              <div key={s.label} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)', padding: '12px 14px', boxShadow: 'var(--shadow)' }}>
                                <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                                <div style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 1 }}>{s.label}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)' }}>
                        <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No target data available</div>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          )}
        {showAki && (
          <div className="modal-overlay" onClick={() => setShowAki(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, width: '92%', borderRadius: 'var(--radius)', overflow: 'hidden', padding: 0 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--card-bg)' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Aaj Ka Incentive</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 1 }}>Today's AKI collection slabs shared for all FROs</div>
                </div>
                <button className="btn btn-sm btn-icon" onClick={() => setShowAki(false)} style={{ padding: 4 }} aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div style={{ padding: '18px 20px', background: 'var(--bg)', maxHeight: '80vh', overflowY: 'auto' }}>
                {akiLoading ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--card-bg)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Loading incentive slabs…</div>
                  </div>
                ) : (
                  <AkiBanner slabs={akiSlabs} compact />
                )}
              </div>
            </div>
          </div>
        )}
        <div className="content-body" style={{ marginRight: drawerOpen ? 320 : 0, transition: 'margin-right .25s ease' }}>
          <Routes>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="my-leads" element={<MyLeadsSuspense />} />
            <Route path="suspense" element={<FroSuspense />} />
            <Route path="donors" element={<Donors />} />
            <Route path="history" element={<History />} />
            <Route path="incentive-info" element={<IncentiveInfo />} />
            <Route path="tickets" element={<FroTickets />} />
            <Route path="whatsapp-chat" element={<WhatsAppComingSoon />} />
            <Route path="whatsapp-chat/:project" element={<WhatsAppComingSoon />} />
            <Route path="*" element={<Navigate to="dashboard" replace />} />
          </Routes>
        </div>
      </div>
      {modalDonor && (
        <DispositionModal
          donorId={modalDonor.id}
          ngoId={modalDonor.ngo_id}
          donorName={modalDonor.donor_name}
          donorMobile={modalDonor.donor_mobile}
          scheduledAt={modalDonor.scheduled_at}
          onClose={() => { setModalNotifId(null); setModalDonor(null); poppedIds.current.clear(); }}
          onDone={handlePopDone}
          onSnooze={handleSnooze}
        />
      )}
      <NotificationDrawer topOffset={72}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sections={drawerSections}
        onItemClick={handleDrawerItemClick}
      />
      <SpecialIncentive />
      <LeadChampionCelebration />
      <NoticePopup />
      <ToastContainer />
    </div>
    </CallProvider>
  )
}
