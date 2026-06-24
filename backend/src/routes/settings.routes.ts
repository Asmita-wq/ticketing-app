import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, ADMIN_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { getSettings, updateSettings } from '../services/settings.service';

export const settingsRoutes = Router();

// Any authenticated user can read settings (the ticket form needs them)
settingsRoutes.get('/', authenticate, async (_req, res) => {
  const settings = await getSettings();
  res.json({ success: true, data: settings });
});

const updateSettingsSchema = z.object({
  requireContactPhone: z.boolean().optional(),
  requireContactEmail: z.boolean().optional(),
  requireCategory: z.boolean().optional(),
  requireSubcategory: z.boolean().optional(),
  requireContactName: z.boolean().optional(),
  categoryLabel: z.string().min(1).max(40).optional(),
  subcategoryLabel: z.string().min(1).max(40).optional(),
});

// Only admins (top + manager) can change settings
settingsRoutes.put(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ body: updateSettingsSchema }),
  async (req, res) => {
    const settings = await updateSettings(req.body);
    res.json({ success: true, data: settings });
  },
);
