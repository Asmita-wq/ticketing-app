import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize, ADMIN_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';

export const emailMailboxRoutes = Router();

emailMailboxRoutes.use(authenticate, authorize(...ADMIN_ROLES));

emailMailboxRoutes.get('/', async (_req: Request, res: Response) => {
  const mailboxes = await prisma.emailMailbox.findMany({ orderBy: { createdAt: 'desc' } });
  const safe = mailboxes.map((m) => ({ ...m, clientSecret: '••••••••' }));
  res.json({ success: true, data: safe });
});

emailMailboxRoutes.get('/:id', async (req: Request, res: Response) => {
  const mailbox = await prisma.emailMailbox.findUnique({ where: { id: req.params.id } });
  if (!mailbox) return res.status(404).json({ success: false, message: 'Mailbox not found' });
  res.json({ success: true, data: { ...mailbox, clientSecret: '••••••••' } });
});

const createSchema = z.object({
  label: z.string().min(1).max(100),
  company: z.string().min(1).max(200),
  mailbox: z.string().email(),
  tenantId: z.string().uuid(),
  clientId: z.string().uuid(),
  clientSecret: z.string().min(1),
});

emailMailboxRoutes.post('/', validate({ body: createSchema }), async (req: Request, res: Response) => {
  const existing = await prisma.emailMailbox.findUnique({ where: { mailbox: req.body.mailbox } });
  if (existing) return res.status(409).json({ success: false, message: 'This mailbox is already configured' });

  const mailbox = await prisma.emailMailbox.create({ data: req.body });
  res.status(201).json({ success: true, data: { ...mailbox, clientSecret: '••••••••' } });
});

const updateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  company: z.string().min(1).max(200).optional(),
  mailbox: z.string().email().optional(),
  tenantId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  clientSecret: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

emailMailboxRoutes.put('/:id', validate({ body: updateSchema }), async (req: Request, res: Response) => {
  const existing = await prisma.emailMailbox.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ success: false, message: 'Mailbox not found' });

  const data = { ...req.body };
  if (data.clientSecret === '••••••••') delete data.clientSecret;

  const mailbox = await prisma.emailMailbox.update({ where: { id: req.params.id }, data });
  res.json({ success: true, data: { ...mailbox, clientSecret: '••••••••' } });
});

emailMailboxRoutes.delete('/:id', async (req: Request, res: Response) => {
  const existing = await prisma.emailMailbox.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ success: false, message: 'Mailbox not found' });

  await prisma.emailMailbox.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Mailbox deleted' });
});

emailMailboxRoutes.post('/:id/test', async (req: Request, res: Response) => {
  const mailbox = await prisma.emailMailbox.findUnique({ where: { id: req.params.id } });
  if (!mailbox) return res.status(404).json({ success: false, message: 'Mailbox not found' });

  try {
    const tokenUrl = `https://login.microsoftonline.com/${mailbox.tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: mailbox.clientId,
      client_secret: mailbox.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.json({ success: true, data: { status: 'error', step: 'oauth', message: `OAuth token failed: ${err}` } });
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };

    const mailRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox.mailbox)}/mailFolders/inbox/messages?$top=1&$select=id`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );

    if (!mailRes.ok) {
      const err = await mailRes.text();
      return res.json({ success: true, data: { status: 'error', step: 'graph', message: `Graph API failed: ${err}` } });
    }

    return res.json({ success: true, data: { status: 'ok', message: 'Connection successful — mailbox is accessible' } });
  } catch (err) {
    return res.json({ success: true, data: { status: 'error', step: 'network', message: (err as Error).message } });
  }
});
