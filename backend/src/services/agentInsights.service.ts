import { TicketStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';

const ALL_STATUSES: TicketStatus[] = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'PENDING_USER',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
];

const hoursBetween = (start: Date, end: Date) => (end.getTime() - start.getTime()) / (1000 * 60 * 60);
const round = (n: number) => Number(n.toFixed(2));

// Rich performance profile for a single agent.
export async function getAgentStats(agentId: string) {
  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, email: true, role: true, department: true, isActive: true, createdAt: true },
  });
  if (!agent) throw ApiError.notFound('Agent not found');

  const base = { assignedToId: agentId };

  const [
    total,
    statusGroups,
    resolvedTickets,
    respondedTickets,
    escalated,
    responseBreaches,
    resolutionBreaches,
    reopenedCount,
    publicComments,
    internalComments,
    lastAssignment,
    recentResolved,
  ] = await Promise.all([
    prisma.ticket.count({ where: base }),
    prisma.ticket.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.ticket.findMany({ where: { ...base, resolvedAt: { not: null } }, select: { createdAt: true, resolvedAt: true } }),
    prisma.ticket.findMany({
      where: { ...base, firstRespondedAt: { not: null } },
      select: { createdAt: true, firstRespondedAt: true },
    }),
    prisma.ticket.count({ where: { ...base, escalated: true } }),
    prisma.ticket.count({ where: { ...base, responseBreached: true } }),
    prisma.ticket.count({ where: { ...base, resolutionBreached: true } }),
    prisma.ticketStatusHistory.count({ where: { toStatus: 'REOPENED', ticket: { assignedToId: agentId } } }),
    prisma.ticketComment.count({ where: { authorId: agentId, visibility: 'PUBLIC' } }),
    prisma.ticketComment.count({ where: { authorId: agentId, visibility: 'INTERNAL' } }),
    prisma.ticketAssignment.findFirst({
      where: { assignedToId: agentId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.ticket.findMany({
      where: { ...base, resolvedAt: { not: null } },
      orderBy: { resolvedAt: 'desc' },
      take: 5,
      select: { ticketNumber: true, title: true, priority: true, createdAt: true, resolvedAt: true },
    }),
  ]);

  // Status breakdown (zero-filled)
  const byStatus: Record<string, number> = {};
  for (const s of ALL_STATUSES) byStatus[s] = 0;
  for (const g of statusGroups) byStatus[g.status] = g._count._all;

  const resolved = byStatus.RESOLVED;
  const closed = byStatus.CLOSED;
  const openLike = byStatus.OPEN + byStatus.ASSIGNED + byStatus.IN_PROGRESS + byStatus.PENDING_USER + byStatus.REOPENED;

  const avgResolutionHours =
    resolvedTickets.length > 0
      ? round(
          resolvedTickets.reduce((sum, t) => sum + hoursBetween(t.createdAt, t.resolvedAt as Date), 0) /
            resolvedTickets.length,
        )
      : null;

  const avgFirstResponseHours =
    respondedTickets.length > 0
      ? round(
          respondedTickets.reduce((sum, t) => sum + hoursBetween(t.createdAt, t.firstRespondedAt as Date), 0) /
            respondedTickets.length,
        )
      : null;

  const completed = resolved + closed;
  const resolutionRate = total > 0 ? round((completed / total) * 100) : 0;

  return {
    agent,
    summary: {
      totalAssigned: total,
      openTickets: openLike,
      resolved,
      closed,
      completed,
      reopened: reopenedCount,
      escalated,
      responseBreaches,
      resolutionBreaches,
      slaBreaches: responseBreaches + resolutionBreaches,
      resolutionRate, // percentage of assigned tickets resolved or closed
      avgResolutionHours,
      avgFirstResponseHours,
      publicComments,
      internalComments,
      lastActiveAt: lastAssignment?.createdAt ?? null,
    },
    byStatus,
    recentResolved,
  };
}

// Lightweight leaderboard for all agents (admin/manager overview).
export async function getAgentsOverview() {
  const agents = await prisma.user.findMany({
    where: { role: { in: ['SUPPORT_AGENT', 'MANAGER', 'ADMIN'] } },
    select: { id: true, name: true, email: true, role: true, isActive: true },
    orderBy: { name: 'asc' },
  });

  return Promise.all(
    agents.map(async (a) => {
      const base = { assignedToId: a.id };
      const [assigned, resolved, closed, breaches, resolvedTickets] = await Promise.all([
        prisma.ticket.count({ where: base }),
        prisma.ticket.count({ where: { ...base, status: 'RESOLVED' } }),
        prisma.ticket.count({ where: { ...base, status: 'CLOSED' } }),
        prisma.ticket.count({ where: { ...base, OR: [{ responseBreached: true }, { resolutionBreached: true }] } }),
        prisma.ticket.findMany({ where: { ...base, resolvedAt: { not: null } }, select: { createdAt: true, resolvedAt: true } }),
      ]);
      const avgResolutionHours =
        resolvedTickets.length > 0
          ? round(
              resolvedTickets.reduce((s, t) => s + hoursBetween(t.createdAt, t.resolvedAt as Date), 0) /
                resolvedTickets.length,
            )
          : null;
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        role: a.role,
        isActive: a.isActive,
        assigned,
        resolved,
        closed,
        slaBreaches: breaches,
        avgResolutionHours,
      };
    }),
  );
}
