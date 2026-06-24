import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EmailMailbox } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { generateTicketNumber } from '../services/ticketNumber.service';
import { computeSlaDueDates } from '../services/sla.service';
import { recordAuditLog } from '../services/audit.service';
import { sendMail, emailTemplates } from '../services/mail.service';
import { ticketUrl } from '../services/ticket.service';

const SYSTEM_USER_EMAIL = 'system-email-bot@helpdesk.internal';

// ── OAuth2 token cache (per mailbox) ────────────────────────────

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

async function getAccessToken(mailbox: EmailMailbox): Promise<string> {
  const cached = tokenCache.get(mailbox.id);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${mailbox.tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: mailbox.clientId,
    client_secret: mailbox.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth2 token failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(mailbox.id, {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

// ── Graph API types ─────────────────────────────────────────────

interface GraphMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  hasAttachments: boolean;
  receivedDateTime: string;
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes: string;
  isInline: boolean;
}

// ── Graph API calls ─────────────────────────────────────────────

async function fetchUnreadMessages(token: string, mailboxEmail: string): Promise<GraphMessage[]> {
  const encoded = encodeURIComponent(mailboxEmail);
  const url = `https://graph.microsoft.com/v1.0/users/${encoded}/mailFolders/inbox/messages?$filter=isRead eq false&$top=50&$select=id,subject,bodyPreview,body,from,hasAttachments,receivedDateTime`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph API fetch messages failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { value?: GraphMessage[] };
  return data.value ?? [];
}

async function fetchAttachments(token: string, mailboxEmail: string, messageId: string): Promise<GraphAttachment[]> {
  const encoded = encodeURIComponent(mailboxEmail);
  const url = `https://graph.microsoft.com/v1.0/users/${encoded}/messages/${messageId}/attachments`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return [];

  const data = (await res.json()) as { value?: GraphAttachment[] };
  return (data.value ?? []).filter((a) => !a.isInline && a.contentBytes);
}

async function markAsRead(token: string, mailboxEmail: string, messageId: string): Promise<void> {
  const encoded = encodeURIComponent(mailboxEmail);
  const url = `https://graph.microsoft.com/v1.0/users/${encoded}/messages/${messageId}`;

  await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ isRead: true }),
  });
}

// ── Signature / footer parsing ──────────────────────────────────

interface ContactInfo {
  name?: string;
  email?: string;
  phone?: string;
}

const PHONE_RE = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,5}[-.\s]?\d{3,5}(?:\d{1,3})?/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const SIGNATURE_MARKERS = [
  /^--\s*$/m,
  /^regards,?\s*$/im,
  /^kind regards,?\s*$/im,
  /^best regards,?\s*$/im,
  /^warm regards,?\s*$/im,
  /^thanks(?:\s*(?:&|and)\s*regards)?,?\s*$/im,
  /^thank you,?\s*$/im,
  /^sincerely,?\s*$/im,
  /^cheers,?\s*$/im,
  /^best,?\s*$/im,
  /^sent from my /im,
];

function splitBodyAndSignature(text: string): { body: string; signature: string } {
  const lines = text.split('\n');

  let splitIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    for (const marker of SIGNATURE_MARKERS) {
      if (marker.test(line)) {
        splitIndex = i;
        break;
      }
    }
    if (splitIndex !== -1) break;
    if (i < lines.length - 15) break;
  }

  if (splitIndex === -1) {
    return { body: text, signature: '' };
  }

  return {
    body: lines.slice(0, splitIndex).join('\n').trim(),
    signature: lines.slice(splitIndex).join('\n').trim(),
  };
}

function extractContactFromSignature(signature: string, fallbackSenderEmail: string, fallbackSenderName: string): ContactInfo {
  const contact: ContactInfo = {};

  const emails = signature.match(EMAIL_RE) ?? [];
  const sigEmail = emails.find((e) => !e.toLowerCase().includes('noreply') && !e.toLowerCase().includes('no-reply'));
  contact.email = sigEmail ?? fallbackSenderEmail;

  const phones = signature.match(PHONE_RE) ?? [];
  const validPhone = phones.find((p) => p.replace(/\D/g, '').length >= 7);
  if (validPhone) contact.phone = validPhone.trim();

  const lines = signature.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cleaned = line.replace(/^[-–—|*•]\s*/, '').trim();
    if (!cleaned) continue;
    if (EMAIL_RE.test(cleaned)) continue;
    if (PHONE_RE.test(cleaned) && cleaned.replace(PHONE_RE, '').trim().length < 5) continue;
    if (/^(regards|thanks|sincerely|cheers|best|sent from|thank you|kind|warm)/i.test(cleaned)) continue;
    if (/^(tel|phone|mob|cell|fax|email|e-mail|website|web|http|www\.)/i.test(cleaned)) continue;

    const namePart = cleaned.replace(/[|,].*$/, '').trim();
    if (namePart.length >= 2 && namePart.length <= 60 && /^[A-Za-z\s.'-]+$/.test(namePart)) {
      contact.name = namePart;
      break;
    }
  }

  if (!contact.name && fallbackSenderName) {
    contact.name = fallbackSenderName;
  }

  return contact;
}

// ── Helpers ─────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function isEmptyEmail(subject: string | null | undefined, body: string): boolean {
  const subjectEmpty = !subject || subject === '(No Subject)' || !subject.trim();
  const bodyEmpty = !body.trim() || body.trim() === '(No content)';
  return subjectEmpty && bodyEmpty;
}

async function saveAttachmentToDisk(attachment: GraphAttachment): Promise<{ filePath: string; fileName: string; fileType: string; fileSize: number }> {
  const ext = path.extname(attachment.name) || '';
  const diskName = `${uuidv4()}${ext}`;
  const filePath = path.join(env.uploads.dir, diskName);

  const buffer = Buffer.from(attachment.contentBytes, 'base64');
  fs.writeFileSync(filePath, buffer);

  return {
    filePath: `/uploads/${diskName}`,
    fileName: attachment.name,
    fileType: attachment.contentType || 'application/octet-stream',
    fileSize: buffer.length,
  };
}

// ── DB helpers ──────────────────────────────────────────────────

async function getOrCreateSystemUser() {
  let user = await prisma.user.findUnique({ where: { email: SYSTEM_USER_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Email Bot',
        email: SYSTEM_USER_EMAIL,
        password: 'nologin',
        role: 'ADMIN',
        isActive: true,
        emailVerified: true,
      },
    });
    logger.info('Created system Email Bot user');
  }
  return user;
}

async function getCategory(name: string, description: string) {
  let category = await prisma.category.findUnique({ where: { name } });
  if (!category) {
    category = await prisma.category.create({ data: { name, description } });
    logger.info(`Created category "${name}"`);
  }
  return category;
}

async function findAutoAssignee(categoryId: string): Promise<{ id: string; name: string; email: string } | null> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: {
      agents: {
        include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
      },
    },
  });

  const activeAgents = (category?.agents ?? []).map((a) => a.user).filter((u) => u.isActive);
  if (activeAgents.length === 0) return null;

  const loads = await Promise.all(
    activeAgents.map((a) =>
      prisma.ticket.count({ where: { assignedToId: a.id, status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
    ),
  );
  let best = 0;
  for (let i = 1; i < loads.length; i++) if (loads[i] < loads[best]) best = i;

  return { id: activeAgents[best].id, name: activeAgents[best].name, email: activeAgents[best].email };
}

// ── Process a single mailbox ────────────────────────────────────

async function processMailbox(mailboxConfig: EmailMailbox) {
  const token = await getAccessToken(mailboxConfig);
  const messages = await fetchUnreadMessages(token, mailboxConfig.mailbox);

  if (messages.length === 0) {
    await prisma.emailMailbox.update({
      where: { id: mailboxConfig.id },
      data: { lastPolledAt: new Date(), lastError: null },
    });
    return;
  }

  const systemUser = await getOrCreateSystemUser();
  let ticketsCreatedCount = 0;

  for (const msg of messages) {
    try {
      const senderAddress = msg.from?.emailAddress?.address ?? 'unknown@unknown.com';
      const senderName = msg.from?.emailAddress?.name ?? '';
      const subject = msg.subject?.trim() || null;

      const rawBody =
        msg.body.contentType === 'text'
          ? msg.body.content.trim()
          : stripHtml(msg.body.content) || msg.bodyPreview || '';

      // Empty email → Email-Trash category
      if (isEmptyEmail(subject, rawBody)) {
        const trashCategory = await getCategory('Email-Trash', 'Empty emails without subject or body');
        const ticketNumber = await generateTicketNumber();
        const { responseDueAt, resolutionDueAt } = await computeSlaDueDates('LOW');

        const trashAssignee = await findAutoAssignee(trashCategory.id);

        await prisma.ticket.create({
          data: {
            ticketNumber,
            title: '(Empty Email)',
            description: '(No subject or body in the original email)',
            categoryId: trashCategory.id,
            priority: 'LOW',
            status: trashAssignee ? 'ASSIGNED' : 'OPEN',
            contactEmail: senderAddress,
            contactName: senderName || undefined,
            company: mailboxConfig.company || undefined,
            createdById: systemUser.id,
            assignedToId: trashAssignee?.id,
            responseDueAt,
            resolutionDueAt,
            statusHistory: {
              create: trashAssignee
                ? [
                    { toStatus: 'OPEN', changedById: systemUser.id, note: `Empty email from ${senderAddress}` },
                    { fromStatus: 'OPEN', toStatus: 'ASSIGNED', changedById: systemUser.id, note: `Auto-assigned to ${trashAssignee.name}` },
                  ]
                : { toStatus: 'OPEN', changedById: systemUser.id, note: `Empty email from ${senderAddress}` },
            },
            ...(trashAssignee
              ? { assignments: { create: { assignedToId: trashAssignee.id, assignedById: systemUser.id } } }
              : {}),
          },
        });

        await markAsRead(token, mailboxConfig.mailbox, msg.id);
        ticketsCreatedCount++;
        logger.info(`[${mailboxConfig.label}] Email→Trash from ${senderAddress} — empty email`);
        continue;
      }

      // Parse signature for contact info and strip from description
      const { body: cleanBody, signature } = splitBodyAndSignature(rawBody);
      const contact = extractContactFromSignature(signature, senderAddress, senderName);

      const ticketNumber = await generateTicketNumber();
      const { responseDueAt, resolutionDueAt } = await computeSlaDueDates('MEDIUM');
      const emailCategory = await getCategory('Email', 'Tickets created from inbound emails');

      const autoAssignee = await findAutoAssignee(emailCategory.id);
      const emailNote = `Created from email sent by ${senderAddress} (via ${mailboxConfig.label})`;

      const ticket = await prisma.ticket.create({
        data: {
          ticketNumber,
          title: subject || '(No Subject)',
          description: cleanBody || rawBody || '(No content)',
          categoryId: emailCategory.id,
          priority: 'MEDIUM',
          status: autoAssignee ? 'ASSIGNED' : 'OPEN',
          contactEmail: contact.email || senderAddress,
          contactName: contact.name || senderName || undefined,
          contactPhone: contact.phone || undefined,
          company: mailboxConfig.company || undefined,
          createdById: systemUser.id,
          assignedToId: autoAssignee?.id,
          responseDueAt,
          resolutionDueAt,
          statusHistory: {
            create: autoAssignee
              ? [
                  { toStatus: 'OPEN', changedById: systemUser.id, note: emailNote },
                  { fromStatus: 'OPEN', toStatus: 'ASSIGNED', changedById: systemUser.id, note: `Auto-assigned to ${autoAssignee.name}` },
                ]
              : { toStatus: 'OPEN', changedById: systemUser.id, note: emailNote },
          },
          ...(autoAssignee
            ? { assignments: { create: { assignedToId: autoAssignee.id, assignedById: systemUser.id } } }
            : {}),
        },
      });

      // Download and attach email attachments
      if (msg.hasAttachments) {
        const attachments = await fetchAttachments(token, mailboxConfig.mailbox, msg.id);
        for (const att of attachments) {
          try {
            const saved = await saveAttachmentToDisk(att);
            await prisma.ticketAttachment.create({
              data: {
                ticketId: ticket.id,
                uploadedById: systemUser.id,
                fileName: saved.fileName,
                filePath: saved.filePath,
                fileType: saved.fileType,
                fileSize: saved.fileSize,
              },
            });
          } catch (err) {
            logger.error(`  Failed to save attachment "${att.name}": ${(err as Error).message}`);
          }
        }
      }

      await recordAuditLog({
        action: 'TICKET_CREATED',
        entityType: 'Ticket',
        entityId: ticket.id,
        performedById: systemUser.id,
        details: {
          ticketNumber: ticket.ticketNumber,
          source: 'email',
          mailbox: mailboxConfig.mailbox,
          senderEmail: senderAddress,
          hasAttachments: msg.hasAttachments,
        },
      });

      // Send confirmation email to the sender
      const recipientEmail = contact.email || senderAddress;
      const confirmHtml = emailTemplates.ticketActivity(
        ticket.ticketNumber,
        'Your Ticket Has Been Created',
        `Your support request "<strong>${subject || '(No Subject)'}</strong>" has been received and assigned ticket number <strong>${ticket.ticketNumber}</strong>. Our team will review it shortly.`,
        ticketUrl(ticket.id),
      );
      await sendMail(recipientEmail, `Ticket Created: ${ticket.ticketNumber}`, confirmHtml);

      await markAsRead(token, mailboxConfig.mailbox, msg.id);
      ticketsCreatedCount++;

      logger.info(
        `[${mailboxConfig.label}] Email→Ticket: ${ticket.ticketNumber} from ${contact.email ?? senderAddress} — "${subject}"`,
      );
    } catch (err) {
      logger.error(`[${mailboxConfig.label}] Failed to process email ${msg.id}: ${(err as Error).message}`);
    }
  }

  await prisma.emailMailbox.update({
    where: { id: mailboxConfig.id },
    data: {
      lastPolledAt: new Date(),
      lastError: null,
      ticketsCreated: { increment: ticketsCreatedCount },
    },
  });
}

// ── Main polling loop ───────────────────────────────────────────

async function pollAllMailboxes() {
  try {
    const mailboxes = await prisma.emailMailbox.findMany({ where: { isActive: true } });

    if (mailboxes.length === 0) return;

    for (const mb of mailboxes) {
      try {
        await processMailbox(mb);
      } catch (err) {
        const errorMsg = (err as Error).message;
        logger.error(`[${mb.label}] Polling failed: ${errorMsg}`);
        await prisma.emailMailbox.update({
          where: { id: mb.id },
          data: { lastPolledAt: new Date(), lastError: errorMsg },
        });
      }
    }
  } catch (err) {
    logger.error(`Email polling failed: ${(err as Error).message}`);
  }
}

export async function startEmailPollingJob() {
  // Migrate env-based config to DB on first run (if DB is empty but env has config)
  const envMailbox = env.msGraph.mailbox;
  if (envMailbox && env.msGraph.clientId && env.msGraph.tenantId) {
    const count = await prisma.emailMailbox.count();
    if (count === 0) {
      await prisma.emailMailbox.create({
        data: {
          label: 'Primary Support',
          company: 'Vaishnavi Consultancy Services',
          mailbox: envMailbox,
          tenantId: env.msGraph.tenantId,
          clientId: env.msGraph.clientId,
          clientSecret: env.msGraph.clientSecret,
          isActive: true,
        },
      });
      logger.info(`Migrated env mailbox config (${envMailbox}) to database`);
    }
  }

  const pollInterval = env.msGraph.pollIntervalMs || 60000;
  logger.info(`Email polling started — checking active mailboxes every ${pollInterval / 1000}s`);

  pollAllMailboxes();
  setInterval(pollAllMailboxes, pollInterval);
}
