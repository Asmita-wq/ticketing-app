import { Router, Request } from 'express';
import { z } from 'zod';
import { ApiError } from '../utils/ApiError';
import { authenticate, authorize, STAFF_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import {
  REPORT_GENERATORS,
  ReportType,
  ReportOptions,
  resolveDuration,
} from '../services/report.service';
import { exportToCsv, exportToExcel, exportToPdf } from '../utils/export';

export const reportRoutes = Router();

reportRoutes.use(authenticate, authorize(...STAFF_ROLES));

// Build report scoping options from the request:
// - Support agents are always scoped to their own assigned tickets
// - Managers/Admins see everything (unless they pass an explicit agentId)
// - duration query maps to a date window
function buildOptions(req: Request): ReportOptions {
  const { duration, agentId } = req.query as { duration?: string; agentId?: string };
  const opts: ReportOptions = { ...resolveDuration(duration) };
  if (req.user!.role === 'SUPPORT_AGENT') {
    opts.agentId = req.user!.sub;
  } else if (agentId) {
    opts.agentId = agentId;
  }
  return opts;
}

reportRoutes.get('/tickets-by-category', async (req, res) => {
  res.json({ success: true, data: await REPORT_GENERATORS['tickets-by-category'](buildOptions(req)) });
});

reportRoutes.get('/tickets-by-agent', async (req, res) => {
  res.json({ success: true, data: await REPORT_GENERATORS['tickets-by-agent'](buildOptions(req)) });
});

reportRoutes.get('/agent-performance', async (req, res) => {
  res.json({ success: true, data: await REPORT_GENERATORS['agent-performance'](buildOptions(req)) });
});

reportRoutes.get('/resolution-time', async (req, res) => {
  res.json({ success: true, data: await REPORT_GENERATORS['resolution-time'](buildOptions(req)) });
});

reportRoutes.get('/sla-breaches', async (req, res) => {
  res.json({ success: true, data: await REPORT_GENERATORS['sla-breaches'](buildOptions(req)) });
});

reportRoutes.get('/monthly-trends', async (req, res) => {
  res.json({ success: true, data: await REPORT_GENERATORS['monthly-trends'](buildOptions(req)) });
});

reportRoutes.get('/ticket-audit-log', async (req, res) => {
  res.json({ success: true, data: await REPORT_GENERATORS['ticket-audit-log'](buildOptions(req)) });
});

const exportQuerySchema = z.object({
  type: z.enum([
    'tickets-by-category',
    'tickets-by-agent',
    'agent-performance',
    'resolution-time',
    'sla-breaches',
    'monthly-trends',
    'ticket-audit-log',
  ]),
  format: z.enum(['csv', 'excel', 'pdf']),
  duration: z.string().optional(),
  agentId: z.string().uuid().optional(),
});

reportRoutes.get('/export', validate({ query: exportQuerySchema }), async (req, res) => {
  const { type, format } = req.query as unknown as { type: ReportType; format: 'csv' | 'excel' | 'pdf' };

  const generator = REPORT_GENERATORS[type];
  if (!generator) throw ApiError.badRequest('Unknown report type');

  const rows = (await generator(buildOptions(req))) as unknown as Record<string, unknown>[];
  const filename = `${type}-${new Date().toISOString().slice(0, 10)}`;

  if (format === 'csv') return exportToCsv(res, filename, rows);
  if (format === 'excel') return exportToExcel(res, filename, rows);
  return exportToPdf(res, filename, type.replace(/-/g, ' ').toUpperCase(), rows);
});
