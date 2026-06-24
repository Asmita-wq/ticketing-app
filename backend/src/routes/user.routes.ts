import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { authenticate, authorize, ADMIN_ROLES, STAFF_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { createAgentSchema, updateAgentSchema, listUsersQuerySchema } from '../validators/user.validators';

export const userRoutes = Router();

userRoutes.use(authenticate);

// List all users (admin only)
userRoutes.get('/', authorize(...ADMIN_ROLES), validate({ query: listUsersQuerySchema }), userController.listUsers);

// List agents (for assignment dropdowns) - any staff member
userRoutes.get('/agents', authorize(...STAFF_ROLES), userController.listAgents);

// List end-users (for raising a ticket on behalf of a user) - any staff member
userRoutes.get('/customers', authorize(...STAFF_ROLES), userController.listCustomers);

// Agent performance tracking (admin + manager)
userRoutes.get('/agents/overview', authorize(...ADMIN_ROLES), userController.agentsOverview);
userRoutes.get('/agents/:id/stats', authorize(...ADMIN_ROLES), userController.agentStats);

userRoutes.get('/:id', authorize(...ADMIN_ROLES), userController.getUser);

userRoutes.post('/agents', authorize(...ADMIN_ROLES), validate({ body: createAgentSchema }), userController.createAgent);

userRoutes.patch('/agents/:id', authorize(...ADMIN_ROLES), validate({ body: updateAgentSchema }), userController.updateAgent);

// Reset a lower-privileged user's password (generates + emails a new temp password)
userRoutes.post('/agents/:id/reset-password', authorize(...ADMIN_ROLES), userController.resetUserPassword);
