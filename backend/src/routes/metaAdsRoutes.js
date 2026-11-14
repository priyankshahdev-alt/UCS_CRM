import { Router } from 'express';
import { authenticateRole } from '../middleware/authMiddleware.js';
import {
  metaAdsStatus,
  listMetaAdAccounts,
  listMetaCampaigns,
  getMetaCampaignInsights,
  getMetaInsightsSummary,
  getMetaFunnelHandler,
  syncMetaInsights,
  syncMetaLeads,
  listMetaForms,
  saveMetaForm,
  deleteMetaForm,
  autoMapMetaForms,
  getMetaWebhookEvents,
  listMetaWebhookPages,
  subscribeMetaWebhook,
  getMetaAdsConfig,
  saveMetaAdsConfig,
  listMetaLeads,
} from '../controllers/metaAdsController.js';

const router = Router();
const READ_ROLES = ['accounts', 'super_admin', 'admin', 'master', 'user'];
const WRITE_ROLES = ['accounts', 'super_admin', 'admin'];

router.get('/status', authenticateRole(...READ_ROLES), metaAdsStatus);
router.get('/ad-accounts', authenticateRole(...READ_ROLES), listMetaAdAccounts);
router.get('/campaigns', authenticateRole(...READ_ROLES), listMetaCampaigns);
router.get('/campaigns/:id/insights', authenticateRole(...READ_ROLES), getMetaCampaignInsights);

router.get('/insights/summary', authenticateRole(...READ_ROLES), getMetaInsightsSummary);
router.get('/funnel', authenticateRole(...READ_ROLES), getMetaFunnelHandler);

// Captured leads with flattened form answers (state, association choice, inbox).
router.get('/leads', authenticateRole(...READ_ROLES), listMetaLeads);
router.post('/insights/sync', authenticateRole(...WRITE_ROLES), syncMetaInsights);
router.post('/leads/sync', authenticateRole(...WRITE_ROLES), syncMetaLeads);

router.get('/forms', authenticateRole(...READ_ROLES), listMetaForms);
router.post('/forms', authenticateRole(...WRITE_ROLES), saveMetaForm);
router.post('/forms/auto-map', authenticateRole(...WRITE_ROLES), autoMapMetaForms);
router.delete('/forms/:formId', authenticateRole(...WRITE_ROLES), deleteMetaForm);

// Webhook management: events are delivery history, pages shows whether this app
// is installed on the Page, subscribe performs the install (subscribed_fields=leadgen).
router.get('/webhook/events', authenticateRole(...READ_ROLES), getMetaWebhookEvents);
router.get('/webhook/pages', authenticateRole(...READ_ROLES), listMetaWebhookPages);
router.post('/webhook/subscribe', authenticateRole(...WRITE_ROLES), subscribeMetaWebhook);

// Credentials live in the settings table (like whatsapp_accounts), editable
// here without touching .env. Masked on read; token verified before it is saved.
router.get('/config', authenticateRole(...WRITE_ROLES), getMetaAdsConfig);
router.post('/config', authenticateRole(...WRITE_ROLES), saveMetaAdsConfig);

export default router;
