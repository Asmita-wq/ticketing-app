import { Prisma, TicketPriority, TicketStatus, UserRole, NotificationType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import { generateTicketNumber } from './ticketNumber.service';
import { computeSlaDueDates } from './sla.service';
import { recordAuditLog } from './audit.service';
import { createNotification, notifyMany } from './notification.service';
import { sendMail, emailTemplates } from './mail.service';
import { getPaginationParams, buildPaginatedResult } from '../utils/pagination';
import { env } from '../config/env';

export function ticketUrl(id: string) {
  return `${env.clientUrl}/tickets/${id}`;
}

const SYSTEM_BOT_EMAIL = 'system-email-bot@helpdesk.internal';

// Send an email directly to the ticket's contactEmail (for email-originated tickets
// or tickets raised on behalf of external users). Skips if contactEmail matches an
// already-notified registered user.
async function notifyTicketContact(
  ticket: { id: string; ticketNumber: string; contactEmail?: string | null; createdById: string },
  opts: { subject: string; heading: string; body: string; actorEmail?: string; actorName?: string },
  notifiedEmails: Set<string>,
) {
  if (!ticket.contactEmail) return;
  if (notifiedEmails.has(ticket.contactEmail.toLowerCase())) return;

  const html = emailTemplates.ticketActivity(ticket.ticketNumber, opts.heading, opts.body, ticketUrl(ticket.id));
  await sendMail(ticket.contactEmail, opts.subject, html, {
    replyTo: opts.actorEmail,
    fromName: opts.actorName ? `${opts.actorName} via Help Desk` : undefined,
  });
}

// Email + in-app notify the ticket's owner and assigned agent (excluding the actor)
// about an activity, with an actionable link back to the ticket.
// Also emails the ticket's contactEmail for email-originated tickets.
async function notifyTicketParties(
  ticket: {
    id: string; ticketNumber: string; title: string; createdById: string;
    assignedToId: string | null; contactEmail?: string | null;
  },
  opts: { actorId: string; type: NotificationType; title: string; message: string },
) {
  const recipientIds = new Set<string>();
  if (ticket.createdById !== opts.actorId) recipientIds.add(ticket.createdById);
  if (ticket.assignedToId && ticket.assignedToId !== opts.actorId) recipientIds.add(ticket.assignedToId);

  const users = recipientIds.size > 0
    ? await prisma.user.findMany({ where: { id: { in: [...recipientIds] } }, select: { id: true, email: true } })
    : [];

  const html = emailTemplates.ticketActivity(ticket.ticketNumber, opts.title, opts.message, ticketUrl(ticket.id));

  // Look up the actor so we can set Reply-To on emails
  const actor = await prisma.user.findUnique({ where: { id: opts.actorId }, select: { name: true, email: true, role: true } });
  const isActorStaff = actor && STAFF_ROLES.includes(actor.role);
  const replyTo = isActorStaff ? actor.email : undefined;
  const fromName = isActorStaff ? `${actor.name} via Help Desk` : undefined;

  const notifiedEmails = new Set<string>();

  await Promise.all(
    users
      .filter((u) => u.email !== SYSTEM_BOT_EMAIL)
      .map((u) => {
        notifiedEmails.add(u.email.toLowerCase());
        return createNotification({
          userId: u.id,
          type: opts.type,
          title: opts.title,
          message: opts.message,
          ticketId: ticket.id,
          email: { to: u.email, subject: `${opts.title}: ${ticket.ticketNumber}`, html, replyTo, fromName },
        });
      }),
  );

  // Also email the contactEmail (for email-originated or on-behalf tickets)
  await notifyTicketContact(
    ticket,
    { subject: `${opts.title}: ${ticket.ticketNumber}`, heading: opts.title, body: opts.message, actorEmail: replyTo, actorName: isActorStaff ? actor.name : undefined },
    notifiedEmails,
  );
}

const STAFF_ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'SUPPORT_AGENT'];

// Valid forward transitions in the ticket workflow.
// REOPENED can branch back into the active flow from RESOLVED/CLOSED.
const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['ASSIGNED', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED'],
  ASSIGNED: ['IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'OPEN', 'CLOSED'],
  IN_PROGRESS: ['PENDING_USER', 'RESOLVED', 'ASSIGNED', 'CLOSED'],
  PENDING_USER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'REOPENED', 'IN_PROGRESS'],
  CLOSED: ['REOPENED'],
  REOPENED: ['ASSIGNED', 'IN_PROGRESS', 'OPEN'],
};

const TICKET_INCLUDE = {
  category: true,
  subcategory: true,
  createdBy: { select: { id: true, name: true, email: true, phone: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
} satisfies Prisma.TicketInclude;

type TicketWithIncludes = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

interface CreateTicketInput {
  title: string;
  description: string;
  categoryId: string;
  subcategoryId?: string;
  priority: TicketPriority;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  onBehalfOfUserId?: string;
  customData?: Record<string, string>;
}

export async function createTicket(
  requester: { id: string; role: UserRole },
  input: CreateTicketInput,
) {
  // Staff may raise a ticket on behalf of a user — that user becomes the owner
  const onBehalf =
    input.onBehalfOfUserId &&
    STAFF_ROLES.includes(requester.role) &&
    input.onBehalfOfUserId !== requester.id;

  if (onBehalf) {
    const target = await prisma.user.findUnique({ where: { id: input.onBehalfOfUserId } });
    if (!target) throw ApiError.badRequest('The selected user does not exist');
  }

  const ownerId = onBehalf ? (input.onBehalfOfUserId as string) : requester.id;

  // Validate required admin-defined custom fields
  const customFields = await prisma.customField.findMany({ where: { active: true } });
  const customData = input.customData ?? {};
  for (const field of customFields) {
    if (field.required && !(customData[field.id] && customData[field.id].trim())) {
      throw ApiError.badRequest(`${field.label} is required`);
    }
  }

  const ticketNumber = await generateTicketNumber();
  const { responseDueAt, resolutionDueAt } = await computeSlaDueDates(input.priority);

  // Auto-assign among the category's default agents (least-loaded wins)
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    include: {
      agents: {
        include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
      },
    },
  });

  let autoAssignee: { id: string; name: string; email: string } | null = null;
  const activeAgents = (category?.agents ?? []).map((a) => a.user).filter((u) => u.isActive);
  if (activeAgents.length > 0) {
    // pick the active agent with the fewest open (non-resolved/closed) tickets
    const loads = await Promise.all(
      activeAgents.map((a) =>
        prisma.ticket.count({ where: { assignedToId: a.id, status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      ),
    );
    let best = 0;
    for (let i = 1; i < loads.length; i++) if (loads[i] < loads[best]) best = i;
    autoAssignee = { id: activeAgents[best].id, name: activeAgents[best].name, email: activeAgents[best].email };
  }

  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber,
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      subcategoryId: input.subcategoryId,
      priority: input.priority,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      ...(input.customData && Object.keys(input.customData).length > 0 ? { customData: input.customData } : {}),
      createdById: ownerId,
      responseDueAt,
      resolutionDueAt,
      ...(autoAssignee ? { assignedToId: autoAssignee.id, status: 'ASSIGNED' as TicketStatus } : {}),
      statusHistory: {
        create: autoAssignee
          ? [
              { toStatus: 'OPEN' as TicketStatus, changedById: ownerId, note: 'Ticket created' },
              {
                fromStatus: 'OPEN' as TicketStatus,
                toStatus: 'ASSIGNED' as TicketStatus,
                changedById: ownerId,
                note: `Auto-assigned to ${autoAssignee.name} (default agent for ${category!.name})`,
              },
            ]
          : [{ toStatus: 'OPEN' as TicketStatus, changedById: ownerId, note: 'Ticket created' }],
      },
      ...(autoAssignee
        ? {
            assignments: {
              create: {
                assignedToId: autoAssignee.id,
                assignedById: ownerId,
                note: `Auto-assigned (default agent for category "${category!.name}")`,
              },
            },
          }
        : {}),
    },
    include: TICKET_INCLUDE,
  });

  if (autoAssignee) {
    await createNotification({
      userId: autoAssignee.id,
      type: 'TICKET_ASSIGNED',
      title: 'Ticket Auto-Assigned',
      message: `Ticket ${ticket.ticketNumber} (${category!.name}) was auto-assigned to you.`,
      ticketId: ticket.id,
      email: {
        to: autoAssignee.email,
        subject: `Ticket Assigned: ${ticket.ticketNumber}`,
        html: emailTemplates.ticketAssigned(ticket.ticketNumber, autoAssignee.name),
      },
    });
  }

  await recordAuditLog({
    action: 'TICKET_CREATED',
    entityType: 'Ticket',
    entityId: ticket.id,
    performedById: requester.id,
    details: {
      ticketNumber: ticket.ticketNumber,
      priority: ticket.priority,
      ...(onBehalf ? { onBehalfOf: ownerId } : {}),
    },
  });

  const user = await prisma.user.findUnique({ where: { id: ownerId } });
  const notifiedEmails = new Set<string>();
  if (user) {
    notifiedEmails.add(user.email.toLowerCase());
    await createNotification({
      userId: ownerId,
      type: 'TICKET_CREATED',
      title: 'Ticket Created',
      message: onBehalf
        ? `A support ticket ${ticket.ticketNumber} has been raised on your behalf.`
        : `Your ticket ${ticket.ticketNumber} has been created.`,
      ticketId: ticket.id,
      email: {
        to: user.email,
        subject: `Ticket Created: ${ticket.ticketNumber}`,
        html: emailTemplates.ticketCreated(ticket.ticketNumber, ticket.title),
      },
    });
  }

  // Also email the contactEmail (email-originated tickets or on-behalf tickets)
  await notifyTicketContact(
    ticket,
    {
      subject: `Ticket Created: ${ticket.ticketNumber}`,
      heading: 'Your Ticket Has Been Created',
      body: `Your support request "<strong>${ticket.title}</strong>" has been received and assigned ticket number <strong>${ticket.ticketNumber}</strong>. Our team will review it shortly.`,
    },
    notifiedEmails,
  );

  return ticket;
}

interface ListTicketsParams {
  page?: number;
  limit?: number;
  status?: TicketStatus;
  priority?: TicketPriority;
  categoryId?: string;
  assignedToId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export async function listTickets(
  params: ListTicketsParams,
  requestingUser: { id: string; role: UserRole },
) {
  const { page, limit, skip } = getPaginationParams(params);

  const where: Prisma.TicketWhereInput = {};

  // Non-staff users only see their own tickets
  if (!STAFF_ROLES.includes(requestingUser.role)) {
    where.createdById = requestingUser.id;
  }

  if (params.status) where.status = params.status;
  if (params.priority) where.priority = params.priority;
  if (params.categoryId) where.categoryId = params.categoryId;
  if (params.assignedToId) where.assignedToId = params.assignedToId;

  if (params.dateFrom || params.dateTo) {
    const createdAtFilter: Prisma.DateTimeFilter = {};
    if (params.dateFrom) createdAtFilter.gte = new Date(params.dateFrom);
    if (params.dateTo) createdAtFilter.lte = new Date(params.dateTo);
    where.createdAt = createdAtFilter;
  }

  if (params.search) {
    where.OR = [
      { title: { contains: params.search, mode: 'insensitive' } },
      { ticketNumber: { contains: params.search, mode: 'insensitive' } },
      { description: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const orderBy: Prisma.TicketOrderByWithRelationInput = {
    [params.sortBy ?? 'createdAt']: params.sortOrder ?? 'desc',
  };

  const [data, total] = await Promise.all([
    prisma.ticket.findMany({ where, skip, take: limit, orderBy, include: TICKET_INCLUDE }),
    prisma.ticket.count({ where }),
  ]);

  return buildPaginatedResult(data, total, page, limit);
}

export async function getTicketById(id: string, requestingUser: { id: string; role: UserRole }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      ...TICKET_INCLUDE,
      attachments: { include: { uploadedBy: { select: { id: true, name: true } } } },
      statusHistory: {
        include: { changedBy: { select: { id: true, name: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      },
      assignments: {
        include: {
          assignedTo: { select: { id: true, name: true } },
          assignedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      mergedTickets: { select: { id: true, ticketNumber: true, title: true } },
    },
  });

  if (!ticket) throw ApiError.notFound('Ticket not found');

  const isOwner = ticket.createdById === requestingUser.id;
  const isStaff = STAFF_ROLES.includes(requestingUser.role);

  if (!isOwner && !isStaff) {
    throw ApiError.forbidden('You do not have access to this ticket');
  }

  return ticket;
}

export async function updateTicket(
  id: string,
  input: Partial<CreateTicketInput>,
  requestingUser: { id: string; role: UserRole },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const isOwner = ticket.createdById === requestingUser.id;
  const isStaff = STAFF_ROLES.includes(requestingUser.role);
  if (!isOwner && !isStaff) throw ApiError.forbidden('You do not have access to this ticket');

  if (['RESOLVED', 'CLOSED'].includes(ticket.status)) {
    throw ApiError.badRequest('Cannot edit a resolved or closed ticket');
  }

  const updated = await prisma.ticket.update({
    where: { id },
    data: input,
    include: TICKET_INCLUDE,
  });

  await recordAuditLog({
    action: 'TICKET_UPDATED',
    entityType: 'Ticket',
    entityId: id,
    performedById: requestingUser.id,
    details: input,
  });

  return updated;
}

export async function assignTicket(
  id: string,
  assignedToId: string,
  note: string | undefined,
  performedById: string,
) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const agent = await prisma.user.findUnique({ where: { id: assignedToId } });
  if (!agent || !STAFF_ROLES.includes(agent.role)) {
    throw ApiError.badRequest('Assignee must be an active staff member');
  }

  const newStatus: TicketStatus = ticket.status === 'OPEN' ? 'ASSIGNED' : ticket.status;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({
      where: { id },
      data: {
        assignedToId,
        status: newStatus,
      },
      include: TICKET_INCLUDE,
    });

    await tx.ticketAssignment.create({
      data: { ticketId: id, assignedToId, assignedById: performedById, note },
    });

    if (newStatus !== ticket.status) {
      await tx.ticketStatusHistory.create({
        data: { ticketId: id, fromStatus: ticket.status, toStatus: newStatus, changedById: performedById, note: 'Auto-updated on assignment' },
      });
    }

    return t;
  });

  await recordAuditLog({
    action: 'TICKET_ASSIGNED',
    entityType: 'Ticket',
    entityId: id,
    performedById,
    details: { assignedToId },
  });

  await createNotification({
    userId: assignedToId,
    type: 'TICKET_ASSIGNED',
    title: 'Ticket Assigned',
    message: `Ticket ${ticket.ticketNumber} has been assigned to you.`,
    ticketId: id,
    email: {
      to: agent.email,
      subject: `Ticket Assigned: ${ticket.ticketNumber}`,
      html: emailTemplates.ticketAssigned(ticket.ticketNumber, agent.name),
    },
  });

  return updated;
}

// Assign many tickets to one agent in a single action.
export async function bulkAssignTickets(
  ticketIds: string[],
  assignedToId: string,
  performedById: string,
) {
  const agent = await prisma.user.findUnique({ where: { id: assignedToId } });
  if (!agent || !agent.isActive || !STAFF_ROLES.includes(agent.role)) {
    throw ApiError.badRequest('Assignee must be an active staff member');
  }

  let assigned = 0;
  const failed: string[] = [];
  for (const id of ticketIds) {
    try {
      await assignTicket(id, assignedToId, 'Bulk assigned', performedById);
      assigned += 1;
    } catch {
      failed.push(id);
    }
  }

  // Large transfers (>5) are flagged to admins & managers via email + in-app notification
  if (assigned > 5) {
    const performer = await prisma.user.findUnique({ where: { id: performedById }, select: { name: true } });
    const recipients = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true },
      select: { id: true, email: true },
    });
    const title = 'Bulk Ticket Transfer';
    const message = `${performer?.name ?? 'A staff member'} transferred ${assigned} tickets to ${agent.name}.`;
    const html = emailTemplates.ticketActivity(
      `${assigned} tickets`,
      title,
      message,
      `${env.clientUrl}/tickets?assignedToId=${assignedToId}`,
    );
    await notifyMany(
      recipients.map((r) => ({
        userId: r.id,
        type: NotificationType.TICKET_ASSIGNED,
        title,
        message,
        email: { to: r.email, subject: `${title} — ${assigned} tickets`, html },
      })),
    );
  }

  return { assigned, failed: failed.length, total: ticketIds.length, assignedTo: agent.name };
}

export async function changeTicketStatus(
  id: string,
  newStatus: TicketStatus,
  note: string | undefined,
  performedById: string,
  performedByRole: UserRole,
) {
  const ticket = await prisma.ticket.findUnique({ where: { id }, include: { createdBy: true } });
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const isOwner = ticket.createdById === performedById;
  const isStaff = STAFF_ROLES.includes(performedByRole);

  // Users may only close their own resolved tickets or reopen closed tickets
  if (!isStaff) {
    if (!isOwner) throw ApiError.forbidden('You do not have access to this ticket');
    const allowedUserTransitions: Partial<Record<TicketStatus, TicketStatus[]>> = {
      RESOLVED: ['CLOSED', 'REOPENED'],
      CLOSED: ['REOPENED'],
    };
    if (!allowedUserTransitions[ticket.status]?.includes(newStatus)) {
      throw ApiError.badRequest(`You cannot change status from ${ticket.status} to ${newStatus}`);
    }
  } else {
    if (!STATUS_TRANSITIONS[ticket.status]?.includes(newStatus) && ticket.status !== newStatus) {
      throw ApiError.badRequest(`Invalid status transition from ${ticket.status} to ${newStatus}`);
    }
  }

  const now = new Date();
  const data: Prisma.TicketUpdateInput = { status: newStatus };

  if (newStatus === 'RESOLVED') data.resolvedAt = now;
  if (newStatus === 'CLOSED') data.closedAt = now;
  if (newStatus === 'REOPENED') {
    data.resolvedAt = null;
    data.closedAt = null;
  }
  if (!ticket.firstRespondedAt && isStaff) data.firstRespondedAt = now;

  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.ticket.update({ where: { id }, data, include: TICKET_INCLUDE });
    await tx.ticketStatusHistory.create({
      data: { ticketId: id, fromStatus: ticket.status, toStatus: newStatus, changedById: performedById, note },
    });
    return t;
  });

  await recordAuditLog({
    action: 'TICKET_STATUS_CHANGED',
    entityType: 'Ticket',
    entityId: id,
    performedById,
    details: { from: ticket.status, to: newStatus, note },
  });

  const notificationType: NotificationType =
    newStatus === 'RESOLVED' ? 'TICKET_RESOLVED' : newStatus === 'CLOSED' ? 'TICKET_CLOSED' : 'STATUS_CHANGED';

  const message =
    newStatus === 'RESOLVED'
      ? `Ticket ${ticket.ticketNumber} has been marked Resolved. If you are not satisfied, open the ticket to reopen it or reply.`
      : `Ticket ${ticket.ticketNumber} status changed to ${newStatus.replace('_', ' ')}.`;

  await notifyTicketParties(updated, {
    actorId: performedById,
    type: notificationType,
    title: 'Ticket Status Updated',
    message,
  });

  return updated;
}

export async function changeTicketPriority(id: string, priority: TicketPriority, performedById: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const { responseDueAt, resolutionDueAt } = await computeSlaDueDates(priority, ticket.createdAt);

  const updated = await prisma.ticket.update({
    where: { id },
    data: { priority, responseDueAt, resolutionDueAt },
    include: TICKET_INCLUDE,
  });

  await recordAuditLog({
    action: 'TICKET_PRIORITY_CHANGED',
    entityType: 'Ticket',
    entityId: id,
    performedById,
    details: { from: ticket.priority, to: priority },
  });

  await notifyTicketParties(updated, {
    actorId: performedById,
    type: 'STATUS_CHANGED',
    title: 'Ticket Priority Updated',
    message: `Priority for ticket ${ticket.ticketNumber} changed to ${priority}.`,
  });

  return updated;
}

export async function escalateTicket(id: string, note: string, performedById: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const updated = await prisma.ticket.update({
    where: { id },
    data: { escalated: true, escalatedAt: new Date(), escalationNote: note, priority: 'CRITICAL' },
    include: TICKET_INCLUDE,
  });

  await recordAuditLog({
    action: 'TICKET_ESCALATED',
    entityType: 'Ticket',
    entityId: id,
    performedById,
    details: { note },
  });

  await notifyTicketParties(updated, {
    actorId: performedById,
    type: 'TICKET_ESCALATED',
    title: 'Ticket Escalated',
    message: `Ticket ${ticket.ticketNumber} has been escalated. ${note ?? ''}`.trim(),
  });

  return updated;
}

const ESCALATION_MIN_AGE_DAYS = 15;

// A ticket owner can escalate to admins/managers once the ticket is older than 15 days.
export async function userEscalateTicket(id: string, note: string | undefined, userId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id }, include: { createdBy: true } });
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (ticket.createdById !== userId) throw ApiError.forbidden('You can only escalate your own tickets');

  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
    throw ApiError.badRequest('Resolved or closed tickets cannot be escalated');
  }

  const ageDays = (Date.now() - ticket.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < ESCALATION_MIN_AGE_DAYS) {
    throw ApiError.badRequest(
      `This ticket can only be escalated after ${ESCALATION_MIN_AGE_DAYS} days. It is ${Math.floor(ageDays)} day(s) old.`,
    );
  }

  const escalationNote = note?.trim()
    ? note.trim()
    : `Escalated by the requester after ${Math.floor(ageDays)} days without resolution.`;

  const updated = await prisma.ticket.update({
    where: { id },
    data: { escalated: true, escalatedAt: new Date(), escalationNote, priority: 'HIGH' },
    include: TICKET_INCLUDE,
  });

  await recordAuditLog({
    action: 'TICKET_ESCALATED',
    entityType: 'Ticket',
    entityId: id,
    performedById: userId,
    details: { note: escalationNote, byUser: true },
  });

  // Notify all admins and managers + the assigned agent (with actionable link)
  const recipients = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: ['ADMIN', 'MANAGER'] }, isActive: true },
        ...(ticket.assignedToId ? [{ id: ticket.assignedToId }] : []),
      ],
    },
    select: { id: true, email: true },
  });

  const html = emailTemplates.ticketActivity(
    ticket.ticketNumber,
    'Ticket Escalated by User',
    escalationNote,
    ticketUrl(ticket.id),
  );

  await notifyMany(
    recipients.map((r) => ({
      userId: r.id,
      type: NotificationType.TICKET_ESCALATED,
      title: 'Ticket Escalated by User',
      message: `Ticket ${ticket.ticketNumber} was escalated by the requester: ${escalationNote}`,
      ticketId: id,
      email: { to: r.email, subject: `Escalated: ${ticket.ticketNumber}`, html },
    })),
  );

  return updated;
}

// Auto-assign to the active support agent with the fewest open tickets (load balancing).
export async function autoAssignTicket(id: string, performedById: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw ApiError.notFound('Ticket not found');

  const agents = await prisma.user.findMany({
    where: { role: 'SUPPORT_AGENT', isActive: true },
    select: { id: true, name: true },
  });
  if (agents.length === 0) throw ApiError.badRequest('No active support agents available to assign');

  const openCounts = await Promise.all(
    agents.map((a) =>
      prisma.ticket.count({ where: { assignedToId: a.id, status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
    ),
  );

  let best = 0;
  for (let i = 1; i < openCounts.length; i++) {
    if (openCounts[i] < openCounts[best]) best = i;
  }
  const chosen = agents[best];

  return assignTicket(
    id,
    chosen.id,
    `Auto-assigned by load balancing (${openCounts[best]} open ticket(s) at time of assignment)`,
    performedById,
  );
}

export async function mergeTickets(targetId: string, sourceTicketIds: string[], performedById: string) {
  const target = await prisma.ticket.findUnique({ where: { id: targetId } });
  if (!target) throw ApiError.notFound('Target ticket not found');

  if (sourceTicketIds.includes(targetId)) {
    throw ApiError.badRequest('A ticket cannot be merged into itself');
  }

  await prisma.$transaction(
    sourceTicketIds.map((sourceId) =>
      prisma.ticket.update({
        where: { id: sourceId },
        data: { mergedIntoId: targetId, status: 'CLOSED', closedAt: new Date() },
      }),
    ),
  );

  await recordAuditLog({
    action: 'TICKET_MERGED',
    entityType: 'Ticket',
    entityId: targetId,
    performedById,
    details: { mergedTickets: sourceTicketIds },
  });

  return getTicketById(targetId, { id: performedById, role: 'ADMIN' });
}
