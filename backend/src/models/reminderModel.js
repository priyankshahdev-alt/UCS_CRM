import db from '../config/db.js';

const TABLE = 'reminders';
const HISTORY_TABLE = 'reminder_history';
const NOTIFICATION_TABLE = 'reminder_notifications';
const SETTINGS_TABLE = 'reminder_settings';

export const createReminder = async (data, userId) => {
  const { data: result, error } = await db
    .from(TABLE)
    .insert([{ ...data, created_by: userId }])
    .select()
    .single();
  if (error) throw error;
  return result;
};

export const getAllReminders = async (includeDeleted = false) => {
  let q = db.from(TABLE).select('*').order('due_date', { ascending: true, nullsFirst: true });
  if (!includeDeleted) q = q.eq('is_deleted', false);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

export const getReminderById = async (id) => {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
};

export const updateReminder = async (id, updates) => {
  const { data, error } = await db
    .from(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const softDeleteReminder = async (id) => {
  const { data, error } = await db
    .from(TABLE)
    .update({ is_deleted: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const bulkInsertReminders = async (rows) => {
  const { data, error } = await db.from(TABLE).insert(rows).select();
  if (error) throw error;
  return data || [];
};

export const createReminderHistory = async (entry) => {
  const { data, error } = await db
    .from(HISTORY_TABLE)
    .insert([entry])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const getReminderHistory = async (reminderId) => {
  const { data, error } = await db
    .from(HISTORY_TABLE)
    .select('*')
    .eq('reminder_id', reminderId)
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
};

export const createNotification = async (entry) => {
  const { data, error } = await db
    .from(NOTIFICATION_TABLE)
    .insert([entry])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const getNotificationsForReminder = async (reminderId) => {
  const { data, error } = await db
    .from(NOTIFICATION_TABLE)
    .select('*')
    .eq('reminder_id', reminderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
};

export const getAllNotifications = async (onlyUnread = false) => {
  let q = db.from(NOTIFICATION_TABLE).select('*').order('created_at', { ascending: false });
  if (onlyUnread) q = q.eq('read', false);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
};

export const markNotificationRead = async (id) => {
  const { data, error } = await db
    .from(NOTIFICATION_TABLE)
    .update({ read: true })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const markAllNotificationsRead = async () => {
  const { data, error } = await db
    .from(NOTIFICATION_TABLE)
    .update({ read: true })
    .neq('read', true)
    .select();
  if (error) throw error;
  return data || [];
};

export const clearNotification = async (id) => {
  const { error } = await db.from(NOTIFICATION_TABLE).delete().eq('id', id);
  if (error) throw error;
  return { message: 'Notification cleared' };
};

export const getSettings = async (userKey) => {
  let q = db.from(SETTINGS_TABLE).select('*').limit(1);
  if (userKey) q = q.eq('user_key', userKey);
  const { data, error } = await q;
  if (error) throw error;
  return (data && data[0]) || null;
};

export const upsertSettings = async (settings) => {
  const existing = await getSettings(settings.user_key || null);
  if (existing) {
    const { data, error } = await db
      .from(SETTINGS_TABLE)
      .update({ ...settings, id: undefined, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db
    .from(SETTINGS_TABLE)
    .insert([{ ...settings, updated_at: new Date().toISOString() }])
    .select()
    .single();
  if (error) throw error;
  return data;
};
