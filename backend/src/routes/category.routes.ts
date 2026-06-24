import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize, ADMIN_ROLES, STAFF_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import {
  createCategorySchema,
  createSubcategorySchema,
  updateCategorySchema,
  updateSubcategorySchema,
} from '../validators/category.validators';
import { ApiError } from '../utils/ApiError';
import { recordAuditLog } from '../services/audit.service';
import { createNotification } from '../services/notification.service';

export const categoryRoutes = Router();

const CATEGORY_INCLUDE = {
  subcategories: true,
  agents: { include: { user: { select: { id: true, name: true, email: true } } } },
} as const;

categoryRoutes.get('/', authenticate, async (_req, res) => {
  const categories = await prisma.category.findMany({
    include: CATEGORY_INCLUDE,
    orderBy: { name: 'asc' },
  });
  res.json({ success: true, data: categories });
});

categoryRoutes.post(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ body: createCategorySchema }),
  async (req, res) => {
    const category = await prisma.category.create({ data: req.body });
    res.status(201).json({ success: true, data: category });
  },
);

categoryRoutes.patch(
  '/:id',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ body: updateCategorySchema }),
  async (req, res) => {
    const category = await prisma.category.update({ where: { id: req.params.id }, data: req.body });
    res.json({ success: true, data: category });
  },
);

categoryRoutes.post(
  '/subcategories',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ body: createSubcategorySchema }),
  async (req, res) => {
    const subcategory = await prisma.subcategory.create({ data: req.body });
    res.status(201).json({ success: true, data: subcategory });
  },
);

categoryRoutes.patch(
  '/subcategories/:id',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ body: updateSubcategorySchema }),
  async (req, res) => {
    const subcategory = await prisma.subcategory.update({
      where: { id: req.params.id },
      data: { name: req.body.name },
    });
    res.json({ success: true, data: subcategory });
  },
);

categoryRoutes.delete('/subcategories/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  await prisma.subcategory.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Subcategory deleted' });
});

// Set the full list of default agents for a category (replaces existing set)
const setAgentsSchema = z.object({
  agentIds: z.array(z.string().uuid()),
});

categoryRoutes.patch(
  '/:id/agents',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ body: setAgentsSchema }),
  async (req, res) => {
    const { agentIds } = req.body as { agentIds: string[] };

    const category = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!category) throw ApiError.notFound('Category not found');

    if (agentIds.length > 0) {
      const valid = await prisma.user.count({
        where: { id: { in: agentIds }, isActive: true, role: { in: STAFF_ROLES } },
      });
      if (valid !== agentIds.length) {
        throw ApiError.badRequest('All assignees must be active staff members');
      }
    }

    // Replace the category's agent set
    await prisma.$transaction([
      prisma.categoryAgent.deleteMany({ where: { categoryId: category.id } }),
      prisma.categoryAgent.createMany({
        data: agentIds.map((userId) => ({ categoryId: category.id, userId })),
      }),
    ]);

    const updated = await prisma.category.findUnique({
      where: { id: category.id },
      include: CATEGORY_INCLUDE,
    });

    await recordAuditLog({
      action: 'CATEGORY_ASSIGNEE_CHANGED',
      entityType: 'Category',
      entityId: category.id,
      performedById: req.user!.sub,
      details: { category: category.name, agentIds },
    });

    // Notify each newly assigned agent
    for (const userId of agentIds) {
      await createNotification({
        userId,
        type: 'TICKET_ASSIGNED',
        title: 'Category Assignment',
        message: `You are now a default agent for the "${category.name}" category. New tickets here may be auto-assigned to you.`,
      });
    }

    res.json({ success: true, data: updated });
  },
);

categoryRoutes.delete('/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  await prisma.category.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Category deleted' });
});
