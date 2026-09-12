import db from '../config/db.js';

export const getAnnouncementByDate = async (date) => {
  const { data, error } = await db
    .from('lead_champion_announcements')
    .select('*')
    .eq('announcement_date', date)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// Latest announcement (for FRO-facing display). Optional date filter for today.
export const getLatestAnnouncement = async (date) => {
  let q = db
    .from('lead_champion_announcements')
    .select('*')
    .order('announcement_date', { ascending: false })
    .limit(1);
  if (date) q = q.eq('announcement_date', date);
  const { data, error } = await q;
  if (error) throw error;
  return (data && data[0]) || null;
};

// Full history of champion announcements, newest first.
export const getAnnouncements = async () => {
  const { data, error } = await db
    .from('lead_champion_announcements')
    .select('*')
    .order('announcement_date', { ascending: false });
  if (error) throw error;
  return data || [];
};

// Hard delete an announcement row. Returns the deleted row so callers can
// confirm / broadcast the removal.
export const deleteAnnouncement = async (id) => {
  const { data, error } = await db
    .from('lead_champion_announcements')
    .delete()
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const insertAnnouncement = async ({
  announcement_date,
  fro_worker_id,
  fro_name,
  total_leads,
  qualified_leads,
  total_amount,
  lead_incentive,
  slab_bonus,
  champion_bonus,
  total_incentive,
  message,
  announced_by,
}) => {
  const { data, error } = await db
    .from('lead_champion_announcements')
    .insert([{
      announcement_date,
      fro_worker_id,
      fro_name,
      total_leads,
      qualified_leads,
      total_amount,
      lead_incentive,
      slab_bonus,
      champion_bonus,
      total_incentive,
      message,
      announced_by,
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
};