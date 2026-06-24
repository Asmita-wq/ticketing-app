import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { getDashboardStats } from '../services/dashboard.service';

export const dashboardRoutes = Router();

dashboardRoutes.get('/', authenticate, async (req, res) => {
  const stats = await getDashboardStats(req.user!.sub, req.user!.role);
  res.json({ success: true, data: stats });
});
