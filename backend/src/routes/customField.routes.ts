import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize, ADMIN_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

export const customFieldRoutes = Router();

// Any authenticated user reads active fields (for the ticket form);
// admins/managers see all (including inactive) for management.
customFieldRoutes.get('/', authenticate, async (req, res) => {
  const isAdmin = ['ADMIN', 'MANAGER'].includes(req.user!.role);
  const fields = await prisma.customField.findMany({
    where: isAdmin ? {} : { active: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ success: true, data: fields });
});

const createSchema = z.object({
  label: z.string().min(1).max(80),
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  order: z.number().int().optional(),
});

const updateSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  required: z.boolean().optional(),
  active: z.boolean().optional(),
  order: z.number().int().optional(),
});

customFieldRoutes.post('/', authenticate, authorize(...ADMIN_ROLES), validate({ body: createSchema }), async (req, res) => {
  const field = await prisma.customField.create({ data: req.body });
  res.status(201).json({ success: true, data: field });
});

customFieldRoutes.patch('/:id', authenticate, authorize(...ADMIN_ROLES), validate({ body: updateSchema }), async (req, res) => {
  const field = await prisma.customField.update({ where: { id: req.params.id }, data: req.body });
  res.json({ success: true, data: field });
});

customFieldRoutes.delete('/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  await prisma.customField.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Custom field deleted' });
});
