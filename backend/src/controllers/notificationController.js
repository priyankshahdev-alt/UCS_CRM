import db from '../config/db.js';
import { emitRealtime } from '../socket.js';
import {
  upsertFcmToken,
  getWorkerNotifications,
  markNotificationRead,
  getUnreadNotificationCount,
  deleteNotification as deleteNotificationModel,
} from '../models/notificationModel.js';

export const registerToken = async (req, res) => {
  try {
    const { worker_id, token, device_type } = req.body;
    if (!worker_id || !token) {
      return res.status(400).json({ message: 'Worker ID and token are required' });
    }
    const result = await upsertFcmToken(worker_id, token, device_type || 'flutter');
    return res.json({ message: 'Token registered', data: result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getNotifications = async (req, res) => {
  try {
    const worker_id = req.params.worker_id;
    const notifications = await getWorkerNotifications(worker_id);
    return res.json(notifications);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const markRead = async (req, res) => {
  try {
    const result = await markNotificationRead(req.params.id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const count = await getUnreadNotificationCount(req.params.worker_id);
    return res.json({ count });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const result = await deleteNotificationModel(req.params.id, req.user.id);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getNotificationLeadInfo = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: notif, error: notifErr } = await db
      .from('notification_log')
      .select('fro_donor_log_id')
      .eq('id', id)
      .maybeSingle();
    if (notifErr || !notif?.fro_donor_log_id) {
      return res.status(404).json({ message: 'Notification or log reference not found' });
    }

    const { data: logs, error: logErr } = await db
      .from('fro_donor_logs')
      .select('id, amount_collected, fro_assignments!inner(id, fro_worker_id, donor_id, ngo_id, donor_profiles!inner(id, name, mobile_number))')
      .eq('id', notif.fro_donor_log_id)
      .limit(1);
    if (logErr || !logs || logs.length === 0) {
      return res.status(404).json({ message: 'Lead log not found' });
    }
    const log = logs[0];

    const asgn = log.fro_assignments;
    const donor = asgn?.donor_profiles;

    return res.json({
      donorId: asgn?.donor_id || donor?.id,
      ngoId: asgn?.ngo_id,
      assignmentId: asgn?.id,
      donorName: donor?.name || 'Unknown',
      donorMobile: donor?.mobile_number || '',
      logId: log.id,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Broadcast a "suspense alert" to FROs. Accounts clicks a bell on the Suspense
// card; every targeted FRO with the web app open hears tele.wav (the FRO frontend
// plays audio on any notification_log insert of type 'suspense_alert'). No FCM
// push — web-app audio is the intended channel. When an { ngo } key
// (bsct/mann/aflf) is given, only FROs covering that NGO are alerted; otherwise
// every FRO-role user is alerted. Returns the number of FROs notified.
export const sendSuspenseAlert = async (req, res) => {
  try {
    const { ngo } = req.body || {};
    const key = (ngo || '').toString().trim().toLowerCase();

    const { rows: froRows, error: froErr } = await db._pool.query(
      `SELECT id FROM workers
        WHERE lower(btrim(coalesce(department, ''))) = 'fro'
          AND COALESCE(is_active, true) = true`
    );
    if (froErr) throw froErr;

    let workerIds = (froRows || []).map(r => r.id);
    if (key) {
      const ngoRows = await db
        .from('fro_station_assignments')
        .select('fro_worker_id, ngo_id, ngos!inner(name)');
      const matchProject = (n) => {
        const low = (n || '').toLowerCase().trim();
        if (low === 'bsct' || low === 'beingsevak' || low === 'being sevak' || low === 'sevak') return 'bsct';
        if (low === 'mann' || low === 'manncar' || low === 'mann care') return 'mann';
        if (low === 'aflf' || low === 'ashray') return 'aflf';
        return null;
      };
      const covered = new Set();
      for (const r of (ngoRows || [])) {
        if (matchProject(r.ngos?.name) === key) covered.add(String(r.fro_worker_id));
      }
      workerIds = workerIds.filter((id) => covered.has(String(id)));
    }

    if (workerIds.length === 0) return res.json({ count: 0, message: 'No FROs to alert' });

    const base = {
      type: 'suspense_alert',
      title: (ngo ? `${ngo.toUpperCase()} ` : '') + 'Suspense Alert',
      body: 'Please check the new suspense entries.',
      sent_at: new Date().toISOString(),
    };
    let inserted = 0;
    for (const wid of workerIds) {
      try {
        const res = await db.from('notification_log').insert({ ...base, worker_id: wid });
        if (res.error) {
          console.error('Failed to send suspense alert to worker', wid, ':', res.error.message);
          continue;
        }
        inserted += 1;
      } catch (e) { console.error('Failed to send suspense alert to worker', wid, ':', e.message); }
    }
    return res.json({ count: inserted, message: `Alert sent to ${inserted} FROs` });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const sendFroAction = async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();
    const actions = {
      follow_up: { title: 'Follow-up Due', body: 'Please work on your follow-up calls.', type: 'fro_action_follow_up' },
      less_calls: { title: 'Less Calls', body: 'Please reduce your call pace for now.', type: 'fro_action_less_calls' },
    };
    const message = actions[action];
    if (!message) return res.status(400).json({ message: 'action must be follow_up or less_calls' });

    const { rows: froRows, error: froErr } = await db._pool.query(
      `SELECT id FROM workers
       WHERE lower(btrim(coalesce(department, ''))) = 'fro'
         AND COALESCE(is_active, true) = true`
    );
    if (froErr) throw froErr;

    const count = (froRows || []).length;
    emitRealtime('fro:action', {
      type: message.type,
      title: message.title,
      body: message.body,
      sent_at: new Date().toISOString(),
    }, 'role:fro');
    return res.json({ count, message: `${message.title} sent to ${count} FROs` });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const sendTestNotification = async (req, res) => {
  try {
    const { worker_id } = req.body;
    if (!worker_id) {
      return res.status(400).json({ message: 'Worker ID is required' });
    }

    const { sendPushNotification } = await import('../services/fcmService.js');
    const fcmResponse = await sendPushNotification(
      worker_id,
      '🔔 Test Notification',
      'This is a manual test notification sent from the app!',
      'notice'
    );

    if (fcmResponse) {
      return res.json({ message: 'Test notification pushed via FCM', fcmResponse });
    }
    return res.json({ message: 'Test notification logged (FCM token not found)' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
