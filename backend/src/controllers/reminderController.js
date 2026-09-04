import {
  createReminder,
  getAllReminders,
  getReminderById,
  updateReminder,
  softDeleteReminder,
  bulkInsertReminders,
  createReminderHistory,
  getReminderHistory,
  createNotification,
  getNotificationsForReminder,
  getAllNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotification,
  getSettings,
  upsertSettings,
} from '../models/reminderModel.js';

export const CATEGORIES = [
  'PROPERTY_MAINTENANCE',
  'BMC_TAX',
  'RENT_TDS',
  'INSURANCE',
  'EDUCATION',
  'VI_BILL',
  'WEBSITE_DOMAIN',
  'VEHICLE_INSURANCE',
  'ELECTRICITY',
  'OTHER_BILL',
];

export const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

export const FREQUENCY_TYPES = ['ONE_TIME', 'DAY', 'WEEK', 'MONTH', 'YEAR'];

const alwaysText = [
  'title', 'description', 'category', 'owner', 'display_frequency',
  'priority', 'status', 'notes', 'reminder_time', 'created_by',
];

// ---- recurrence + status helpers (all computed, never hardcoded) ----------

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

export function computeDueMeta(reminder, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = parseDate(reminder.due_date);
  const renewal = parseDate(reminder.renewal_date);

  if (reminder.completed_at) {
    return { daysLeft: null, daysOverdue: null, derivedStatus: 'Completed' };
  }

  const reference = due || renewal;
  if (!reference) {
    return { daysLeft: null, daysOverdue: null, derivedStatus: 'Upcoming', dueDate: null, renewalDate: null };
  }

  const isDue = !!due;
  const target = due || renewal;
  const days = Math.round((target.getTime() - start) / 86400000);

  let derivedStatus;
  let daysOverdue = null;
  if (days < 0) {
    derivedStatus = 'Overdue';
    daysOverdue = Math.abs(days);
  } else if (days === 0) {
    derivedStatus = 'Due Today';
  } else if (days === 1) {
    derivedStatus = 'Due Tomorrow';
  } else {
    derivedStatus = 'Upcoming';
  }

  return {
    daysLeft: isDue ? days : null,
    daysOverdue,
    derivedStatus,
    dueDate: due,
    renewalDate: renewal,
  };
}

export function nextDueDate(reminder, today = new Date()) {
  const type = reminder.frequency_type;
  if (!type || type === 'ONE_TIME') return null;
  const interval = parseInt(reminder.frequency_interval, 10) || 1;
  const day = parseInt(reminder.day_of_month, 10);
  const month = parseInt(reminder.month_of_year, 10);

  // Start from the current due date (or today) and advance until it's in the future.
  const startDate = parseDate(reminder.due_date) || new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let d = new Date(startDate.getTime());

  const guard = (max = 2000) => {
    let n = 0;
    return {
      ok() { return n++ < max; },
    };
  };

  if (type === 'DAY') {
    while (d <= today) d.setDate(d.getDate() + interval);
    return toISO(d);
  }
  if (type === 'WEEK') {
    const step = interval * 7;
    while (d <= today) d.setDate(d.getDate() + step);
    return toISO(d);
  }
  if (type === 'MONTH') {
    const g = guard();
    if (day) {
      d = new Date(d.getFullYear(), d.getMonth(), day);
      while (d <= today && g.ok()) d.setMonth(d.getMonth() + interval);
    } else {
      while (d <= today && g.ok()) d.setMonth(d.getMonth() + interval);
    }
    return toISO(d);
  }
  if (type === 'YEAR') {
    const g = guard();
    if (day && month) {
      d = new Date(d.getFullYear(), month - 1, day);
      while (d <= today && g.ok()) d.setFullYear(d.getFullYear() + interval);
    } else {
      while (d <= today && g.ok()) d.setFullYear(d.getFullYear() + interval);
    }
    return toISO(d);
  }
  return null;
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Guard against accidental negative/zero day values from month math.
function clampMonthDate(year, month, day) {
  const d = new Date(year, month, day);
  return d;
}

// ---- body cleaning ---------------------------------------------------------

function clean(data) {
  const c = { ...(data || {}) };
  delete c.id;
  delete c.created_at;
  delete c.updated_at;
  delete c.created_by;

  alwaysText.forEach((k) => {
    if (c[k] === undefined || c[k] === null) c[k] = '';
    if (c[k] === '') c[k] = null;
  });

  ['due_date', 'renewal_date'].forEach((k) => {
    if (c[k] === undefined || c[k] === null) c[k] = null;
    if (c[k] === '') c[k] = null;
  });

  ['frequency_interval', 'day_of_month', 'month_of_year', 'reminder_minutes_before']
    .forEach((k) => {
      if (c[k] === undefined || c[k] === null || c[k] === '') c[k] = null;
      if (c[k] !== null) c[k] = Number(c[k]) || null;
    });

  ['alarm_enabled', 'reminder_enabled', 'notification_enabled']
    .forEach((k) => {
      if (c[k] === undefined || c[k] === null) c[k] = false;
      c[k] = !!c[k];
    });

  if (!c.category) c.category = null;
  if (!c.priority) c.priority = 'Medium';
  if (!c.frequency_type) c.frequency_type = 'ONE_TIME';

  return c;
}

function isUndefined(v) {
  return v === undefined;
}

// ---- controllers -----------------------------------------------------------

export const validateUser = async (req, res) => {
  const user = req.user || {};
  return user.login_id || user.email || user.id || user.name || null;
};

export const addReminder = async (req, res) => {
  try {
    const body = clean(req.body);
    if (!body.title || !String(body.title).trim()) {
      return res.status(400).json({ message: 'Reminder name is required' });
    }
    if (body.category && !CATEGORIES.includes(body.category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }
    const reminder = await createReminder(body, await validateUser(req, res));
    return res.status(201).json({ message: 'Reminder added successfully', reminder });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listReminders = async (req, res) => {
  try {
    const reminders = await getAllReminders(false);
    const now = new Date();
    const withMeta = reminders.map((r) => {
      const meta = computeDueMeta(r, now);
      return { ...r, ...meta };
    });
    return res.json(withMeta);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getReminder = async (req, res) => {
  try {
    const r = await getReminderById(req.params.id);
    if (!r || r.is_deleted) return res.status(404).json({ message: 'Reminder not found' });
    const meta = computeDueMeta(r);
    return res.json({ ...r, ...meta });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const editReminder = async (req, res) => {
  try {
    const body = req.body || {};
    if (isUndefined(body.title) || !String(body.title).trim()) {
      return res.status(400).json({ message: 'Reminder name is required' });
    }
    if (body.category && !CATEGORIES.includes(body.category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }

    const before = await getReminderById(req.params.id);
    if (!before || before.is_deleted) {
      return res.status(404).json({ message: 'Reminder not found' });
    }

    const writable = {};
    for (const [k, v] of Object.entries(body)) {
      if (['id', 'created_at', 'updated_at', 'is_deleted', 'created_by'].includes(k)) continue;
      if (alwaysText.includes(k)) {
        writable[k] = v === null || v === undefined ? null : String(v);
        if (writable[k] === '') writable[k] = null;
        continue;
      }
      if (['alarm_enabled', 'reminder_enabled', 'notification_enabled'].includes(k)) {
        writable[k] = !!v;
        continue;
      }
      if (['frequency_interval', 'day_of_month', 'month_of_year', 'reminder_minutes_before'].includes(k)) {
        writable[k] = v === undefined || v === null || v === '' ? null : (Number(v) || null);
        continue;
      }
      if (['due_date', 'renewal_date'].includes(k)) {
        writable[k] = v === undefined || v === null || v === '' ? null : String(v).slice(0, 10);
        continue;
      }
      if (v === undefined) continue;
      writable[k] = v === '' || v === null ? null : v;
    }

    const changedCols = {};
    for (const [k, v] of Object.entries(writable)) {
      const prev = before[k] ?? null;
      const newVal = v ?? null;
      if (String(prev) !== String(newVal)) {
        changedCols[k] = { old: prev, new: newVal };
      }
    }

    const reminder = await updateReminder(req.params.id, writable);

    if (Object.keys(changedCols).length > 0) {
      const changedBy = await validateUser(req, res);
      try {
        await createReminderHistory({
          reminder_id: before.id,
          changed_by: changedBy,
          action: 'updated',
          changed_cols: changedCols,
          before_data: before,
          after_data: { ...before, ...writable },
        });
      } catch (e) {
        // history write failure should not block the update
      }
    }

    const meta = computeDueMeta(reminder);
    return res.json({ message: 'Reminder saved successfully', reminder: { ...reminder, ...meta } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const removeReminder = async (req, res) => {
  try {
    await softDeleteReminder(req.params.id);
    return res.json({ message: 'Reminder deleted' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const historyForReminder = async (req, res) => {
  try {
    const history = await getReminderHistory(req.params.id);
    return res.json(history);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const completeReminder = async (req, res) => {
  try {
    const before = await getReminderById(req.params.id);
    if (!before || before.is_deleted) return res.status(404).json({ message: 'Reminder not found' });

    const now = new Date();
    const updates = { completed_at: now.toISOString(), status: 'Completed' };

    const settings = await getSettings();
    const autoNext = settings ? settings.auto_create_next_recurring !== false : true;

    let nextDue = null;
    if (autoNext) {
      nextDue = nextDueDate(before, now);
      if (nextDue) {
        updates.due_date = nextDue;
        updates.completed_at = null;
        updates.status = 'Upcoming';
        if (before.renewal_date) updates.renewal_date = before.renewal_date;
      }
    }

    const reminder = await updateReminder(req.params.id, updates);

    const changedBy = await validateUser(req, res);
    const changedCols = {
      status: { old: before.status || 'Upcoming', new: updates.status },
    };
    if (nextDue) changedCols.due_date = { old: before.due_date, new: nextDue };
    try {
      await createReminderHistory({
        reminder_id: before.id,
        changed_by: changedBy,
        action: nextDue ? 'completed_and_advanced' : 'completed',
        changed_cols: changedCols,
        before_data: before,
        after_data: { ...before, ...updates },
      });
    } catch (e) {
      // non-fatal
    }

    const meta = computeDueMeta(reminder, now);
    return res.json({
      message: nextDue ? 'Reminder completed. Next due date calculated.' : 'Reminder completed',
      reminder: { ...reminder, ...meta },
      nextDue,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const snoozeReminder = async (req, res) => {
  try {
    const { minutes } = req.body || {};
    const m = Number(minutes);
    if (!m || m < 1) return res.status(400).json({ message: 'Snooze minutes are required' });

    const before = await getReminderById(req.params.id);
    if (!before || before.is_deleted) return res.status(404).json({ message: 'Reminder not found' });

    const snoozeUntil = new Date(Date.now() + m * 60000).toISOString();
    const reminder = await updateReminder(req.params.id, { snooze_until: snoozeUntil, status: 'Snoozed' });

    const changedBy = await validateUser(req, res);
    try {
      await createReminderHistory({
        reminder_id: before.id,
        changed_by: changedBy,
        action: 'snoozed',
        changed_cols: {
          snooze_until: { old: before.snooze_until || null, new: snoozeUntil },
          status: { old: before.status || 'Upcoming', new: 'Snoozed' },
        },
        before_data: before,
        after_data: reminder,
      });
    } catch (e) {
      // non-fatal
    }

    return res.json({ message: `Snoozed for ${m} minutes`, reminder, snooze_until: snoozeUntil });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listNotifications = async (req, res) => {
  try {
    const onlyUnread = req.query.unread === 'true';
    const notifications = await getAllNotifications(onlyUnread);
    return res.json(notifications);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const notificationsForReminder = async (req, res) => {
  try {
    const notifications = await getNotificationsForReminder(req.params.id);
    return res.json(notifications);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const markRead = async (req, res) => {
  try {
    const n = await markNotificationRead(req.params.id);
    return res.json({ message: 'Notification marked as read', notification: n });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const markAllRead = async (req, res) => {
  try {
    await markAllNotificationsRead();
    return res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const removeNotification = async (req, res) => {
  try {
    await clearNotification(req.params.id);
    return res.json({ message: 'Notification cleared' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getReminderSettings = async (req, res) => {
  try {
    const userKey = await validateUser(req, res);
    const settings = await getSettings(userKey);
    return res.json(settings || {});
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const saveReminderSettings = async (req, res) => {
  try {
    const userKey = await validateUser(req, res);
    const settings = { ...(req.body || {}), user_key: userKey };
    const saved = await upsertSettings(settings);
    return res.json({ message: 'Settings saved successfully', settings: saved });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const importReminders = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: 'No rows to import' });
    }
    const valid = [];
    const invalid = [];
    const userKey = await validateUser(req, res);
    for (const raw of rows) {
      const row = clean(raw);
      if (!row.title || !String(row.title).trim()) {
        invalid.push({ row, reason: 'Missing: Reminder name' });
        continue;
      }
      if (row.category && !CATEGORIES.includes(row.category)) {
        invalid.push({ row, reason: `Invalid category: ${row.category}` });
        continue;
      }
      row.created_by = userKey;
      if (!row.status) row.status = 'Upcoming';
      valid.push(row);
    }
    const inserted = valid.length ? await bulkInsertReminders(valid) : [];
    return res.status(201).json({
      message: `Imported ${inserted.length} reminder(s)`,
      valid: inserted.length,
      invalid: invalid.length,
      invalidRows: invalid,
      inserted: (inserted || []).map((r) => r.id).filter(Boolean),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
