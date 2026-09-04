import { Router } from 'express';
import {
  addReminder,
  listReminders,
  getReminder,
  editReminder,
  removeReminder,
  historyForReminder,
  completeReminder,
  snoozeReminder,
  listNotifications,
  notificationsForReminder,
  markRead,
  markAllRead,
  removeNotification,
  getReminderSettings,
  saveReminderSettings,
  importReminders,
} from '../controllers/reminderController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = Router();

const ANY_AUTH = authenticate;

router.get('/', ANY_AUTH, listReminders);
router.get('/notifications', ANY_AUTH, listNotifications);
router.get('/settings', ANY_AUTH, getReminderSettings);
router.get('/:id', ANY_AUTH, getReminder);
router.get('/:id/history', ANY_AUTH, historyForReminder);
router.get('/:id/notifications', ANY_AUTH, notificationsForReminder);

router.post('/', ANY_AUTH, addReminder);
router.post('/import', ANY_AUTH, importReminders);
router.post('/settings', ANY_AUTH, saveReminderSettings);
router.post('/notifications/mark-all-read', ANY_AUTH, markAllRead);
router.post('/notifications/:id', ANY_AUTH, markRead);
router.post('/:id/complete', ANY_AUTH, completeReminder);
router.post('/:id/snooze', ANY_AUTH, snoozeReminder);

router.put('/:id', ANY_AUTH, editReminder);
router.delete('/:id', ANY_AUTH, removeReminder);
router.delete('/notifications/:id', ANY_AUTH, removeNotification);

export default router;
