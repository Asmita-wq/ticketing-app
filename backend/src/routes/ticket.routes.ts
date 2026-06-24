import { Router } from 'express';
import * as ticketController from '../controllers/ticket.controller';
import { authenticate, authorize, STAFF_ROLES, ADMIN_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { upload } from '../middlewares/upload';
import {
  createTicketSchema,
  updateTicketSchema,
  assignTicketSchema,
  changeStatusSchema,
  changePrioritySchema,
  escalateSchema,
  mergeSchema,
  bulkAssignSchema,
  listTicketsQuerySchema,
} from '../validators/ticket.validators';

export const ticketRoutes = Router();

ticketRoutes.use(authenticate);

ticketRoutes.post('/', validate({ body: createTicketSchema }), ticketController.createTicket);
ticketRoutes.get('/', validate({ query: listTicketsQuerySchema }), ticketController.listTickets);
ticketRoutes.get('/:id', ticketController.getTicket);
ticketRoutes.patch('/:id', validate({ body: updateTicketSchema }), ticketController.updateTicket);

ticketRoutes.post(
  '/:id/assign',
  authorize(...STAFF_ROLES),
  validate({ body: assignTicketSchema }),
  ticketController.assignTicket,
);

ticketRoutes.post(
  '/bulk-assign',
  authorize(...STAFF_ROLES),
  validate({ body: bulkAssignSchema }),
  ticketController.bulkAssignTickets,
);

ticketRoutes.post('/:id/auto-assign', authorize(...STAFF_ROLES), ticketController.autoAssignTicket);

ticketRoutes.patch('/:id/status', validate({ body: changeStatusSchema }), ticketController.changeStatus);

ticketRoutes.patch(
  '/:id/priority',
  authorize(...STAFF_ROLES),
  validate({ body: changePrioritySchema }),
  ticketController.changePriority,
);

ticketRoutes.post(
  '/:id/escalate',
  authorize(...STAFF_ROLES),
  validate({ body: escalateSchema }),
  ticketController.escalateTicket,
);

// Ticket owner can escalate to admins/managers (enforced: owner + >15 days)
ticketRoutes.post(
  '/:id/user-escalate',
  validate({ body: escalateSchema }),
  ticketController.userEscalateTicket,
);

ticketRoutes.post(
  '/:id/merge',
  authorize(...ADMIN_ROLES),
  validate({ body: mergeSchema }),
  ticketController.mergeTickets,
);

ticketRoutes.post('/:id/attachments', upload.single('file'), ticketController.uploadAttachment);
