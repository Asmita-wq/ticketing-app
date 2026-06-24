import { Router } from 'express';
import { z } from 'zod';
import { Prisma, AuditAction } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate, authorize, ADMIN_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { getPaginationParams, buildPaginatedResult } from '../utils/pagination';

export const auditLogRoutes = Router();

const listAuditLogsSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  action: z.nativeEnum(AuditAction).optional(),
  entityType: z.string().optional(),
  performedById: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

auditLogRoutes.get(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ query: listAuditLogsSchema }),
  async (req, res) => {
    const query = req.query as z.infer<typeof listAuditLogsSchema>;
    const { page, limit, skip } = getPaginationParams(query);

    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.performedById) where.performedById = query.performedById;
    if (query.dateFrom || query.dateTo) {
      const createdAtFilter: Prisma.DateTimeFilter = {};
      if (query.dateFrom) createdAtFilter.gte = new Date(query.dateFrom);
      if (query.dateTo) createdAtFilter.lte = new Date(query.dateTo);
      where.createdAt = createdAtFilter;
    }

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { performedBy: { select: { id: true, name: true, email: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ success: true, ...buildPaginatedResult(data, total, page, limit) });
  },
);
