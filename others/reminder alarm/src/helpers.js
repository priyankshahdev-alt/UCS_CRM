export const CATEGORIES = [
  { key: 'PROPERTY_MAINTENANCE', label: 'Property Maintenance', icon: 'home' },
  { key: 'BMC_TAX', label: 'BMC Tax', icon: 'money' },
  { key: 'RENT_TDS', label: 'Rent & TDS', icon: 'file' },
  { key: 'INSURANCE', label: 'Insurance', icon: 'shield' },
  { key: 'EDUCATION', label: 'Education & School Fees', icon: 'book' },
  { key: 'VI_BILL', label: 'VI Bills', icon: 'wifi' },
  { key: 'WEBSITE_DOMAIN', label: 'Website Domain Renewal', icon: 'globe' },
  { key: 'VEHICLE_INSURANCE', label: 'Vehicle Insurance', icon: 'car' },
  { key: 'ELECTRICITY', label: 'Electricity Bills', icon: 'zap' },
  { key: 'OTHER_BILL', label: 'Other Bills', icon: 'file' },
]

export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical']

export const FREQUENCY_OPTIONS = [
  { value: 'ONE_TIME', label: 'One Time' },
  { value: 'DAY', label: 'Every Day' },
  { value: 'WEEK', label: 'Every Week' },
  { value: 'MONTH', label: 'Every Month' },
  { value: 'MONTH_2', label: 'Every 2 Months' },
  { value: 'MONTH_3', label: 'Every 3 Months' },
  { value: 'MONTH_6', label: 'Every 6 Months' },
  { value: 'YEAR', label: 'Every Year' },
  { value: 'CUSTOM', label: 'Custom' },
]

export const SNOOZE_OPTIONS = [
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
]

export const REMIND_BEFORE_OPTIONS = [
  { value: 0, label: 'At due time' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
  { value: 10080, label: '1 week before' },
  { value: -1, label: 'Custom' },
]

export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayObj() {
  return new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
}

export function daysLeft(dateStr) {
  if (!dateStr) return null
  const today = todayObj()
  const target = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`)
  return Math.round((target - today) / 86400000)
}

export function derivedStatus(reminder) {
  if (reminder.completed_at) return 'Completed'
  if (reminder.snooze_until && new Date(reminder.snooze_until) > new Date()) return 'Snoozed'
  const dl = daysLeft(reminder.due_date)
  if (dl === null) return reminder.status || 'Upcoming'
  if (dl < 0) return 'Overdue'
  if (dl === 0) return 'Due Today'
  if (dl === 1) return 'Due Tomorrow'
  if (dl <= 7) return 'Due Soon'
  return 'Upcoming'
}

export function statusPillClass(status) {
  const map = {
    Overdue: 'pill-overdue',
    'Due Today': 'pill-due-today',
    'Due Tomorrow': 'pill-due-today',
    'Due Soon': 'pill-due-soon',
    Upcoming: 'pill-upcoming',
    Completed: 'pill-completed',
    Snoozed: 'pill-snoozed',
  }
  return map[status] || 'pill-neutral'
}

export function priorityPillClass(priority) {
  const map = { Low: 'pill-low', Medium: 'pill-medium', High: 'pill-high', Critical: 'pill-critical' }
  return map[priority] || 'pill-neutral'
}

export function statusDotClass(status) {
  const map = {
    Overdue: 'dot-overdue',
    'Due Today': 'dot-due-today',
    'Due Tomorrow': 'dot-due-today',
    'Due Soon': 'dot-due-soon',
    Upcoming: 'dot-upcoming',
    Completed: 'dot-completed',
    Snoozed: 'dot-snoozed',
  }
  return map[status] || 'dot-upcoming'
}

export function formatDate(d) {
  if (!d) return '—'
  const s = String(d).slice(0, 10)
  const [y, m, day] = s.split('-')
  if (!y || !m || !day) return d
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${day} ${months[Number(m) - 1]} ${y}`
}

export function formatDateTime(d) {
  if (!d) return '—'
  try {
    const dt = new Date(d)
    const date = formatDate(dt.toISOString().slice(0, 10))
    let h = dt.getHours()
    const m = String(dt.getMinutes()).padStart(2, '0')
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${date}, ${h}:${m} ${ampm}`
  } catch { return d }
}

export function categoryLabel(key) {
  const found = CATEGORIES.find(c => c.key === key)
  return found ? found.label : key || '—'
}

export function categoryIcon(key) {
  const found = CATEGORIES.find(c => c.key === key)
  return found ? found.icon : 'bell'
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

export const EXPORT_COLUMNS = [
  'Reminder / Property', 'Category', 'Owner', 'Due Date', 'Renewal Date',
  'Frequency', 'Days Left', 'Priority', 'Status', 'Alarm', 'Reminder', 'Notes',
]

export function toExportRow(r) {
  const dl = daysLeft(r.due_date)
  return [
    r.title || '', r.category || '', r.owner || '',
    r.due_date ? formatDate(r.due_date) : '',
    r.renewal_date ? formatDate(r.renewal_date) : '',
    r.display_frequency || '', dl !== null ? dl : '',
    r.priority || '', derivedStatus(r),
    r.alarm_enabled ? 'ON' : 'OFF', r.reminder_enabled ? 'ON' : 'OFF',
    r.notes || '',
  ]
}

export function exportToCSV(reminders) {
  const header = EXPORT_COLUMNS
  const rows = [header, ...reminders.map(r => toExportRow(r))]
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n')
  downloadBlob('\ufeff' + csv, `reminders-${todayStr()}.csv`, 'text/csv;charset=utf-8;')
}

function xmlEscape(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

export function exportToExcel(reminders) {
  const header = EXPORT_COLUMNS
  const rows = reminders.map(r => toExportRow(r))
  const all = [header, ...rows]
  const body = all.map(r => {
    const cells = r.map(v => `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`).join('')
    return `<Row>${cells}</Row>`
  }).join('')
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Reminders"><Table>${body}</Table></Worksheet></Workbook>`
  downloadBlob(xml, `reminders-${todayStr()}.xls`, 'application/vnd.ms-excel')
}

export function parseFrequencyLabel(freqType, interval, day, month) {
  if (!freqType || freqType === 'ONE_TIME') return 'One Time'
  const suffix = (n) => { if (n === 1) return ''; return ` ${n}` }
  const ord = (n) => {
    if (n === 1) return '1st'
    if (n === 2) return '2nd'
    if (n === 3) return '3rd'
    return `${n}th`
  }
  switch (freqType) {
    case 'DAY': return interval > 1 ? `Every ${interval} days` : 'Every Day'
    case 'WEEK': return interval > 1 ? `Every ${interval} weeks` : 'Every Week'
    case 'MONTH': {
      if (day) {
        return interval > 1 ? `${ord(day)} of Every ${interval} Months` : `${ord(day)} of Every Month`
      }
      return interval > 1 ? `Every ${interval} Months` : 'Every Month'
    }
    case 'YEAR': {
      if (day && month) {
        const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        return interval > 1 ? `${ord(day)} ${m[month - 1]} Every ${interval} Years` : `${ord(day)} ${m[month - 1]} Every Year`
      }
      return interval > 1 ? `Every ${interval} Years` : 'Every Year'
    }
    default: return freqType
  }
}
