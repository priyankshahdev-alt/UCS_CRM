import db from '../config/db.js';

export const listTickets = async (req, res) => {
  try {
    const { status, department, category } = req.query;
    let query = db
      .from('support_tickets')
      .select('*, workers!support_tickets_raised_by_fkey(name, login_id)')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (department) query = query.eq('department', department);
    if (category) query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const listMyTickets = async (req, res) => {
  try {
    const workerId = req.user.id;
    const { data, error } = await db
      .from('support_tickets')
      .select('*')
      .eq('raised_by', workerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: ticket, error } = await db
      .from('support_tickets')
      .select('*, workers!support_tickets_raised_by_fkey(name, login_id), users!support_tickets_resolved_by_fkey(name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const { data: replies, error: replyError } = await db
      .from('ticket_replies')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });
    if (replyError) throw replyError;

    return res.json({ ...ticket, replies: replies || [] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const createTicket = async (req, res) => {
  try {
    const { department, category, subject, description, reference_id, priority, desk_number, ngo, raised_by_panel } = req.body;
    if (!subject) return res.status(400).json({ message: 'Subject is required' });

    const { data, error } = await db
      .from('support_tickets')
      .insert({
        raised_by: req.user.id,
        department: department || 'accounts',
        category: category || 'other',
        subject,
        description: description || null,
        reference_id: reference_id || null,
        priority: priority || 'medium',
        desk_number: desk_number || null,
        ngo: ngo || null,
        raised_by_panel: raised_by_panel || null,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolution, department, category, priority } = req.body;

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (resolution !== undefined) updates.resolution = resolution;
    if (department !== undefined) updates.department = department;
    if (category !== undefined) updates.category = category;
    if (priority !== undefined) updates.priority = priority;
    if (status === 'resolved' || status === 'closed') {
      updates.resolved_by = req.user.id;
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await db
      .from('support_tickets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const addReply = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: 'Message is required' });

    const { data: ticket } = await db
      .from('support_tickets')
      .select('id')
      .eq('id', id)
      .single();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const { data, error } = await db
      .from('ticket_replies')
      .insert({
        ticket_id: id,
        sender_id: req.user.id,
        sender_type: req.user.role === 'fro' ? 'worker' : 'user',
        message,
      })
      .select()
      .single();

    if (error) throw error;

    await db
      .from('support_tickets')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getWorkers = async (req, res) => {
  try {
    const { data, error } = await db
      .from('workers')
      .select('id, name, login_id, department')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
