import { Router } from 'express';
import { authenticate, authenticateRole } from '../middleware/authMiddleware.js';
import {
  listTickets, listMyTickets, getTicket, createTicket, updateTicket, addReply, getWorkers
} from '../controllers/ticketController.js';

const router = Router();

router.use(authenticate);

router.get('/workers', getWorkers);
router.get('/my', listMyTickets);

router.post('/', createTicket);
router.get('/', authenticateRole('accounts', 'super_admin', 'event_head'), listTickets);
router.get('/:id', getTicket);
router.put('/:id', authenticateRole('accounts', 'super_admin'), updateTicket);
router.post('/:id/reply', addReply);

export default router;
