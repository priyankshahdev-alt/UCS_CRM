import db from '../config/db.js';

export const getAllSlabs = async () => {
  const { data, error } = await db
    .from('incentive_slabs')
    .select('*')
    .order('min_amount', { ascending: true });
  if (error) throw error;
  return data || [];
};

export const getActiveSlabs = async () => {
  const { data, error } = await db
    .from('incentive_slabs')
    .select('*')
    .eq('is_active', true)
    .order('min_amount', { ascending: true });
  if (error) throw error;
  return data || [];
};

export const getSlabById = async (id) => {
  const { data, error } = await db
    .from('incentive_slabs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
};

export const createSlab = async ({ min_amount, max_amount, incentive_amount, min_lead_amount, lead_rate }) => {
  const { data, error } = await db
    .from('incentive_slabs')
    .insert([{
      min_amount,
      max_amount,
      incentive_amount,
      min_lead_amount: min_lead_amount ?? 300,
      lead_rate: lead_rate ?? 20,
      is_active: true,
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateSlab = async (id, { min_amount, max_amount, incentive_amount, min_lead_amount, lead_rate }) => {
  const { data, error } = await db
    .from('incentive_slabs')
    .update({
      min_amount,
      max_amount,
      incentive_amount,
      min_lead_amount: min_lead_amount ?? 300,
      lead_rate: lead_rate ?? 20,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const deleteSlab = async (id) => {
  const { data, error } = await db
    .from('incentive_slabs')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

export const updateAllSlabs = async ({ min_lead_amount, lead_rate }) => {
  const { data, error } = await db
    .from('incentive_slabs')
    .update({
      min_lead_amount,
      lead_rate,
      updated_at: new Date().toISOString(),
    })
    .eq('is_active', true)
    .select();
  if (error) throw error;
  return data || [];
};
