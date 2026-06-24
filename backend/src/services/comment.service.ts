import { CommentVisibility, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import { recordAuditLog } from './audit.service';
import { createNotification } from './notification.service';
import { sendMail, emailTemplates } from './mail.service';
import { ticketUrl } from './ticket.service';

const STAFF_ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'SUPPORT_AGENT'];

export async function listComments(ticketId: string, requestingUser: { id: string; role: UserRole }) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const isStaff = STAFF_ROLES.includes(requestingUser.role);
  const isOwner = ticket.createdById === requestingUser.id;
  if (!isStaff && !isOwner) throw ApiError.forbidden('You do not have access to this ticket');

  return prisma.ticketComment.findMany({
    where: {
      ticketId,
      ...(isStaff ? {} : { visibility: 'PUBLIC' }),
    },
    include: {
      author: { select: { id: true, name: true, role: true, avatarUrl: true } },
      attachments: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function addComment(
  ticketId: string,
  message: string,
  visibility: CommentVisibility,
  requestingUser: { id: string; role: UserRole },
) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { createdBy: true, assignedTo: true },
  });
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const isStaff = STAFF_ROLES.includes(requestingUser.role);
  const isOwner = ticket.createdById === requestingUser.id;
  if (!isStaff && !isOwner) throw ApiError.forbidden('You do not have access to this ticket');

  // Regular users cannot create internal notes
  const effectiveVisibility = isStaff ? visibility : 'PUBLIC';

  const comment = await prisma.ticketComment.create({
    data: {
      ticketId,
      authorId: requestingUser.id,
      message,
      visibility: effectiveVisibility,
    },
    include: {
      author: { select: { id: true, name: true, role: true, avatarUrl: true } },
    },
  });

  // If user is replying and ticket was PENDING_USER, move back to IN_PROGRESS
  if (!isStaff && ticket.status === 'PENDING_USER') {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: 'IN_PROGRESS' } });
    await prisma.ticketStatusHistory.create({
      data: { ticketId, fromStatus: 'PENDING_USER', toStatus: 'IN_PROGRESS', changedById: requestingUser.id, note: 'User replied' },
    });
  }

  await recordAuditLog({
    action: 'COMMENT_ADDED',
    entityType: 'Ticket',
    entityId: ticketId,
    performedById: requestingUser.id,
    details: { visibility: effectiveVisibility },
  });

  // Notify the other party for public comments (with an actionable link to reply)
  if (effectiveVisibility === 'PUBLIC') {
    const link = ticketUrl(ticket.id);
    const notifiedEmails = new Set<string>();

    if (isStaff) {
      // Look up acting agent for Reply-To
      const agent = await prisma.user.findUnique({ where: { id: requestingUser.id }, select: { name: true, email: true } });

      notifiedEmails.add(ticket.createdBy.email.toLowerCase());
      await createNotification({
        userId: ticket.createdById,
        type: 'COMMENT_ADDED',
        title: 'New Reply on Your Ticket',
        message: `A staff member replied to ticket ${ticket.ticketNumber}. Open the ticket to reply or reopen it.`,
        ticketId,
        email: {
          to: ticket.createdBy.email,
          subject: `New Reply: ${ticket.ticketNumber}`,
          html: emailTemplates.ticketActivity(
            ticket.ticketNumber,
            'New Reply on Your Ticket',
            'A support agent has replied to your ticket. You can reply, or reopen it if your issue is not resolved.',
            link,
          ),
          replyTo: agent?.email,
          fromName: agent ? `${agent.name} via Help Desk` : undefined,
        },
      });

      // Also email the contactEmail for email-originated tickets
      if (ticket.contactEmail && !notifiedEmails.has(ticket.contactEmail.toLowerCase())) {
        const html = emailTemplates.ticketActivity(
          ticket.ticketNumber,
          'New Reply on Your Ticket',
          'A support agent has replied to your ticket. You can reply, or reopen it if your issue is not resolved.',
          link,
        );
        await sendMail(ticket.contactEmail, `New Reply: ${ticket.ticketNumber}`, html, {
          replyTo: agent?.email,
          fromName: agent ? `${agent.name} via Help Desk` : undefined,
        });
      }
    } else if (ticket.assignedToId && ticket.assignedTo) {
      await createNotification({
        userId: ticket.assignedToId,
        type: 'COMMENT_ADDED',
        title: 'New Reply from User',
        message: `The user replied to ticket ${ticket.ticketNumber}.`,
        ticketId,
        email: {
          to: ticket.assignedTo.email,
          subject: `New Reply: ${ticket.ticketNumber}`,
          html: emailTemplates.ticketActivity(
            ticket.ticketNumber,
            'New Reply from the Requester',
            `The requester has replied to ticket "${ticket.title}".`,
            link,
          ),
        },
      });
    }
  }

  return comment;
}
