import { Router } from 'express';
import multer from 'multer';
import { authenticateRole } from '../middleware/authMiddleware.js';
import {
  listNgoSuspense, linkSuspenseToDonor, markSuspenseUnmatched, searchDonorsForSuspense,
} from '../controllers/bankAuditController.js';
import {
  listLeads,
  createLead,
  importLeads,
  assignLeads,
  transferLead,
  getLeadHistory,
  getDuplicateLeads,
  getFullDonorDetail,
  getDonorReceipts,
  getDonorFollowups,
  createFollowup,
  getDonorTransactions,
} from '../controllers/ngoAdminController.js';
import {
  getDonors,
  getDonorDetail,
  getFroWorkers,
  getAccessibleNgos,
  getAssignments,
  setTarget,
  getTargets,
  getDonorCreditLogs,
  transferDonorCredit,
  getDashboard,
  getDailyTarget,
  getFroWiseCollection,
  setAchievedTarget,
  setIncentive,
  getAccountsPending,
  verifyLeadDone,
  getStations,
  saveStationAssignment,
  removeStationAssignment,
  removeStationByName,
  createStationHandler,
  reassignStationFro,
  updateStationNgos,
  getStationStats,
  getDonorsByStation,
  getDonorsByFro,
  getNewData,
  distributeNewData,
  cleanupNewData,
  resetFreshData,
  getDataOverview,
  getAlerts,
  acknowledgeAlert,
  getRejectedLeads,
  acknowledgeRejectedLead,
  getDataRequests,
  resolveDataRequest,
  transferStationData,
  returnTransferEarly,
  getTransferHistory,
  getTransferDonors,
  getIncentives,
  getVerificationFroWise,
  getFroPerformance,
  masterSearch,
  getCallAnalytics,
  getFroSummary,
  seedStations,
  cleanupOrphanedStations,
  bulkRenameStations,
  getStationRenameLog,
  uploadOldData,
  uploadOldDataForStation,
  // NEW Dashboard APIs
  getTLDashboard,
  getDonationFunnel,
  getHourlyPerformance,
  getFollowups,
  reassignFollowup,
  updateFollowupDate,
  getIdleAlerts,
  getTopPerformers,
  getBottomPerformers,
  getAssignedData,
  restoreWrongAssignments,
  getFroHourlyPerformance,
  ensureStandardNgos,
} from '../controllers/ngoAdminController.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();

router.get('/rejected-leads', authenticateRole('admin', 'super_admin'), getRejectedLeads);
router.put('/rejected-leads/:id/acknowledge', authenticateRole('admin', 'super_admin'), acknowledgeRejectedLead);

// Accounts reports need stations/targets/ngos — allow accounts role for these read-only endpoints
router.get('/stations', authenticateRole('admin', 'super_admin', 'accounts'), getStations);
router.get('/targets', authenticateRole('admin', 'super_admin', 'accounts'), getTargets);
router.get('/ngos', authenticateRole('admin', 'super_admin', 'accounts'), getAccessibleNgos);
router.post('/ngos/ensure', authenticateRole('admin', 'super_admin'), ensureStandardNgos);

// Accounts panel handles New Data distribution + Old Data viewing — allow accounts role
router.get('/donors-by-station', authenticateRole('admin', 'super_admin', 'accounts'), getDonorsByStation);
router.get('/new-data', authenticateRole('admin', 'super_admin', 'accounts'), getNewData);
router.post('/new-data/distribute', authenticateRole('admin', 'super_admin', 'accounts'), distributeNewData);
router.post('/new-data/cleanup', authenticateRole('admin', 'super_admin', 'accounts'), cleanupNewData);
router.post('/new-data/reset', authenticateRole('admin', 'super_admin', 'accounts'), resetFreshData);

router.use(authenticateRole('admin', 'super_admin'));

router.get('/dashboard', getDashboard);
router.get('/dashboard/daily-target', getDailyTarget);
router.get('/dashboard/station-stats', getStationStats);

// NEW TL Dashboard APIs
router.get('/tl-dashboard', getTLDashboard);
router.get('/dashboard/donation-funnel', getDonationFunnel);
router.get('/dashboard/hourly-performance', getHourlyPerformance);
router.get('/dashboard/idle-alerts', getIdleAlerts);
router.get('/dashboard/top-performers', getTopPerformers);
router.get('/dashboard/bottom-performers', getBottomPerformers);

// Follow-up Management
router.get('/followups', getFollowups);
router.put('/followups/:assignmentId/reassign', reassignFollowup);
router.put('/followups/:assignmentId/date', updateFollowupDate);

// Assigned Data
router.get('/assigned-data', getAssignedData);

router.get('/donors', getDonors);
router.get('/donors/:donorId/credit', getDonorCreditLogs);
router.put('/credit-logs/:logId/transfer', transferDonorCredit);
router.get('/donors/:mobile', getDonorDetail);
router.get('/donors-by-fro', getDonorsByFro);
router.get('/fro-workers', getFroWorkers);
router.get('/assignments', getAssignments);
router.post('/targets', setTarget);
router.get('/collections/fro-wise', getFroWiseCollection);
router.get('/fro-performance', getFroPerformance);
router.get('/fro/:id/summary', getFroSummary);
router.post('/achieved-target', setAchievedTarget);
router.get('/incentives', getIncentives);
router.post('/incentive', setIncentive);
router.get('/verification', getVerificationFroWise);
router.get('/accounts/pending', getAccountsPending);
router.post('/accounts/:logId/verify', verifyLeadDone);

router.post('/stations', createStationHandler);
router.post('/station-assignments', saveStationAssignment);
router.delete('/station-assignments/:id', removeStationAssignment);
router.put('/station-assignments/:id/reassign', reassignStationFro);
router.put('/stations/:station/update-ngos', updateStationNgos);
router.delete('/stations/:station', removeStationByName);
router.post('/stations/:station/transfer-data', transferStationData);
router.get('/transfers', getTransferHistory);
router.get('/transfers/:id/donors', getTransferDonors);
router.post('/transfers/:id/return-early', returnTransferEarly);

router.get('/data-overview', getDataOverview);

router.get('/alerts', getAlerts);
router.put('/alerts/:id/acknowledge', acknowledgeAlert);

router.get('/database-requests', getDataRequests);
router.put('/database-requests/:id/resolve', resolveDataRequest);

router.get('/suspense', listNgoSuspense);
router.put('/suspense/:id/link-donor', linkSuspenseToDonor);
router.put('/suspense/:id/no-match', markSuspenseUnmatched);
router.get('/suspense/search-donors', searchDonorsForSuspense);

// Donor CRM
router.get('/donor-crm/leads', listLeads);
router.post('/donor-crm/leads', createLead);
router.post('/donor-crm/leads/import', importLeads);
router.put('/donor-crm/leads/assign', assignLeads);
router.put('/donor-crm/leads/:id/transfer', transferLead);
router.get('/donor-crm/leads/history', getLeadHistory);
router.get('/donor-crm/duplicates', getDuplicateLeads);
router.get('/donor-crm/donors/:id', getFullDonorDetail);
router.get('/donor-crm/donors/:id/receipts', getDonorReceipts);
router.get('/donor-crm/donors/:id/followups', getDonorFollowups);
router.get('/donor-crm/donors/:id/transactions', getDonorTransactions);
router.post('/donor-crm/followups', createFollowup);

router.get('/master-search', masterSearch);
router.get('/call-analytics', getCallAnalytics);
router.get('/fro-hourly-performance', getFroHourlyPerformance);

router.post('/stations/seed', seedStations);
router.post('/stations/cleanup', cleanupOrphanedStations);
router.post('/stations/bulk-rename', bulkRenameStations);
router.get('/stations/rename-log', getStationRenameLog);
router.post('/stations/:station/upload-old-data', upload.single('file'), uploadOldDataForStation);
router.post('/old-data/upload', upload.single('file'), uploadOldData);

router.post('/restore-wrong-assignments', restoreWrongAssignments);

export default router;
