import { Router } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize, ADMIN_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { upsertSlaSchema } from '../validators/sla.validators';

export const slaRoutes = Router();

slaRoutes.use(authenticate);

slaRoutes.get('/', async (_req, res) => {
  const configs = await prisma.sLAConfiguration.findMany({ orderBy: { priority: 'asc' } });
  res.json({ success: true, data: configs });
});

slaRoutes.put('/', authorize(...ADMIN_ROLES), validate({ body: upsertSlaSchema }), async (req, res) => {
  const { priority, responseTimeMins, resolutionTimeMins } = req.body;

  const config = await prisma.sLAConfiguration.upsert({
    where: { priority },
    update: { responseTimeMins, resolutionTimeMins },
    create: { priority, responseTimeMins, resolutionTimeMins },
  });

  res.json({ success: true, data: config });
});
