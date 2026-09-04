import { Router } from 'express';
import { authenticate, authenticateRole } from '../middleware/authMiddleware.js';
import {
  listFroSuspense, resolveSuspenseEntry, searchFroDispositions,
} from '../controllers/bankAuditController.js';
import {
  getDashboard,
  getMyCollections,
  getMyDonors,
  getTransferredLeads,
  updateDonorStatus,
  updateDonorType,
  getDonorLogs,
  createDonorLogHandler,
  getMyTarget,
  scheduleContact,
  uploadPaymentScreenshot,
  getMyStations,
  getFroScheduled,
  getFroCallbacks,
  getFroPromises,
  getMyHistory,
  requestData,
  getMyDataRequests,
  getFollowUps,
  getLeadStats,
  getMonthlyDonors,
  getDonorHistory,
  getFullDonorHistory,
  getDonorDonations,
  getDonorReceipts,
  getRejectedLeads,
  searchDonors,
  getMyDisposedLeads,
  updateLiveStatus,
  getLiveStatuses,
  getMyProgress,
  saveMyProgress,
  getReactivatedDonors,
  getSuspenseReceipts,
  claimSuspenseReceipt,
  searchSuspenseDonors,
} from '../controllers/froController.js';

const router = Router();

router.use(authenticate);

router.get('/status', authenticateRole('super_admin', 'admin'), getLiveStatuses);

const requireFro = (req, res, next) => {
  if (req.user.role === 'fro') return next();
  if (req.user.department && req.user.department.toLowerCase().trim() === 'fro') return next();
  return res.status(403).json({ message: 'FRO worker access required' });
};

router.use(requireFro);

router.get('/my-stations', getMyStations);
router.get('/dashboard', getDashboard);
router.get('/dashboard/collections', getMyCollections);
router.get('/dashboard/suspense', getSuspenseReceipts);
router.post('/dashboard/suspense/:receiptId/claim', claimSuspenseReceipt);
router.get('/reactivated-donors', getReactivatedDonors);
router.get('/donors', getMyDonors);
router.get('/queue/current', (req, res, next) => {
  // Backend-authoritative "current donor" for the controlled queue: reuses the
  // getMyDonors pipeline (same scope/ordering/filtering/dedup) but returns only
  // the single next donor plus durable progress, so the front-end never picks
  // or skips the next donor itself.
  req.query = { ...req.query, queue_current: 'true', limit: undefined, offset: undefined };
  return getMyDonors(req, res).catch(next);
});
router.get('/transferred-leads', getTransferredLeads);
router.put('/donors/:id/status', updateDonorStatus);
router.put('/donors/:id/donor-type', updateDonorType);
router.put('/donors/:id/mark-seen', async (req, res) => {
  try {
    const { id } = req.params;
    const donorId = parseInt(id);
    const { ngo_id } = req.body;
    let query = db
      .from('fro_assignments')
      .update({ is_new: false })
      .eq('donor_id', donorId)
      .eq('fro_worker_id', req.user.id)
      .not('status', 'eq', 'reassigned');
    if (ngo_id) query = query.eq('ngo_id', ngo_id);
    const { error } = await query;
    if (error) throw error;
    return res.json({ message: 'Marked as seen' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});
router.get('/donors/:id/logs', getDonorLogs);
router.post('/donors/:id/logs', createDonorLogHandler);
router.post('/donors/:id/schedule', scheduleContact);
router.post('/upload-payment-screenshot', uploadPaymentScreenshot);
router.get('/scheduled', getFroScheduled);
router.get('/callbacks', getFroCallbacks);
router.get('/promises', getFroPromises);
router.put('/status', updateLiveStatus);
router.get('/progress', getMyProgress);
router.put('/progress', saveMyProgress);
router.get('/history', getMyHistory);
router.get('/target', getMyTarget);
router.post('/request-data', requestData);
router.get('/database-requests', getMyDataRequests);
router.get('/follow-ups', getFollowUps);
router.get('/rejected-leads', getRejectedLeads);
router.get('/lead-stats', getLeadStats);
router.get('/monthly-donors', getMonthlyDonors);
router.get('/donors/:id/history', getDonorHistory);
router.get('/donors/:id/full-history', getFullDonorHistory);
router.get('/donors/:id/donations', getDonorDonations);
router.get('/donors/:id/receipts', getDonorReceipts);
router.get('/search-donors', searchDonors);
router.get('/my-disposed-leads', getMyDisposedLeads);

router.get('/suspense', listFroSuspense);
router.get('/suspense/search-dispositions', searchFroDispositions);
router.get('/suspense/donor-search', searchSuspenseDonors);
router.put('/suspense/:id/resolve', resolveSuspenseEntry);

export default router;
