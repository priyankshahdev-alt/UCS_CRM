import { messaging } from '../config/firebase.js';
import { logNotification } from '../models/notificationModel.js';

// ==== MASTER SWITCH ====
// Notifications are ON by default. Set NOTIFICATIONS_ENABLED=false in the
// environment to disable all FCM push delivery + notification_log writes.
const NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED !== 'false';

export const sendPushNotification = async (workerId, title, body, type, referenceId = null) => {
  try {
    if (!NOTIFICATIONS_ENABLED) {
      return null;
    }

    const cleanTitle = String(title == null ? '' : title).trim();
    const cleanBody = String(body == null ? '' : body).trim();
    if (!cleanTitle) {
      console.log('Skipping push: empty notification title');
      return null;
    }

    if (!messaging) {
      console.log('Firebase not initialized, skipping push');
      return null;
    }

    const { getFcmToken } = await import('../models/notificationModel.js');
    const tokenData = await getFcmToken(workerId);
    if (!tokenData) {
      console.log(`No FCM token for worker ${workerId}`);
      return null;
    }

    const message = {
      token: tokenData.token,
      notification: { title: cleanTitle, body: cleanBody },
      data: {
        type: type || 'general',
        referenceId: referenceId || '',
        workerId: workerId || '',
      },
    };

    const response = await messaging.send(message);

    await logNotification({
      worker_id: workerId,
      type: type || 'general',
      title: cleanTitle,
      body: cleanBody,
      reference_id: referenceId,
    });

    return response;
  } catch (error) {
    if (error.code === 'messaging/registration-token-not-registered') {
      console.log(`FCM token invalid for worker ${workerId}, removing...`);
      const db = (await import('../config/db.js')).default;
      await db.from('fcm_tokens').delete().eq('worker_id', workerId);
    }
    console.error('FCM send error:', error.message);
    return null;
  }
};

export const sendPushToMultiple = async (notifications) => {
  const results = [];
  for (const n of notifications) {
    const result = await sendPushNotification(
      n.workerId, n.title, n.body, n.type, n.referenceId
    );
    results.push(result);
  }
  return results;
};

// Always records a notification_log row (drives the FRO web bell + realtime
// toast via the socket broadcast) and additionally attempts an FCM push when
// a mobile token exists. Unlike sendPushNotification, the log is written even
// without a token so web-only FROs still receive the alert.
export const notifyWorker = async (workerId, title, body, type, referenceId = null) => {
  try {
    const cleanTitle = String(title == null ? '' : title).trim();
    const cleanBody = String(body == null ? '' : body).trim();
    if (!workerId || !cleanTitle) return null;

    const { logNotification, getFcmToken } = await import('../models/notificationModel.js');
    const entry = await logNotification({
      worker_id: workerId,
      type: type || 'general',
      title: cleanTitle,
      body: cleanBody,
      reference_id: referenceId,
    });

    try {
      if (NOTIFICATIONS_ENABLED && messaging) {
        const tokenData = await getFcmToken(workerId);
        if (tokenData?.token) {
          await messaging.send({
            token: tokenData.token,
            notification: { title: cleanTitle, body: cleanBody },
            data: { type: type || 'general', referenceId: referenceId || '', workerId: workerId || '' },
          });
        }
      }
    } catch (pushErr) {
      console.error('FCM send error (notifyWorker):', pushErr.message);
    }
    return entry;
  } catch (error) {
    console.error('notifyWorker failed:', error.message);
    return null;
  }
};
