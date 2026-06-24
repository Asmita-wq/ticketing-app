import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate } from '../middlewares/auth';
import { getPaginationParams, buildPaginatedResult } from '../utils/pagination';

export const notificationRoutes = Router();

notificationRoutes.use(authenticate);

notificationRoutes.get('/', async (req, res) => {
  const { page, limit, skip } = getPaginationParams(req.query as Record<string, never>);

  const [data, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user!.sub },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId: req.user!.sub } }),
    prisma.notification.count({ where: { userId: req.user!.sub, isRead: false } }),
  ]);

  res.json({ success: true, ...buildPaginatedResult(data, total, page, limit), unreadCount });
});

notificationRoutes.patch('/:id/read', async (req, res) => {
  const notification = await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user!.sub },
    data: { isRead: true },
  });
  res.json({ success: true, data: notification });
});

notificationRoutes.patch('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.sub, isRead: false },
    data: { isRead: true },
  });
  res.json({ success: true, message: 'All notifications marked as read' });
});
