import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface ReportOptions {
  // When set, scope the report to a single agent (their assigned tickets)
  agentId?: string;
  // Duration window applied to createdAt
  from?: Date;
  to?: Date;
}

// Build a ticket where-clause honouring agent scoping + date window
function ticketWhere(opts: ReportOptions): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {};
  if (opts.agentId) where.assignedToId = opts.agentId;
  if (opts.from || opts.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (opts.from) createdAt.gte = opts.from;
    if (opts.to) createdAt.lte = opts.to;
    where.createdAt = createdAt;
  }
  return where;
}

export async function getTicketsByCategoryReport(opts: ReportOptions = {}) {
  const raw = await prisma.ticket.groupBy({
    by: ['categoryId'],
    _count: { _all: true },
    where: ticketWhere(opts),
  });
  const categories = await prisma.category.findMany();
  return raw.map((r) => ({
    category: categories.find((c) => c.id === r.categoryId)?.name ?? 'Unknown',
    count: r._count._all,
  }));
}

export async function getTicketsByAgentReport(opts: ReportOptions = {}) {
  const agents = await prisma.user.findMany({
    where: opts.agentId
      ? { id: opts.agentId }
      : { role: { in: ['SUPPORT_AGENT', 'MANAGER', 'ADMIN'] } },
  });

  const dateWindow = opts.from || opts.to ? ticketWhere({ from: opts.from, to: opts.to }) : {};

  return Promise.all(
    agents.map(async (agent) => {
      const base = { assignedToId: agent.id, ...dateWindow };
      const [assigned, resolved, closed] = await Promise.all([
        prisma.ticket.count({ where: base }),
        prisma.ticket.count({ where: { ...base, status: 'RESOLVED' } }),
        prisma.ticket.count({ where: { ...base, status: 'CLOSED' } }),
      ]);
      return { agent: agent.name, email: agent.email, assigned, resolved, closed };
    }),
  );
}

export async function getResolutionTimeReport(opts: ReportOptions = {}) {
  const tickets = await prisma.ticket.findMany({
    where: { ...ticketWhere(opts), resolvedAt: { not: null } },
    select: {
      ticketNumber: true,
      title: true,
      priority: true,
      createdAt: true,
      resolvedAt: true,
    },
  });

  return tickets.map((t) => ({
    ticketNumber: t.ticketNumber,
    title: t.title,
    priority: t.priority,
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    resolutionTimeHours: Number(
      ((t.resolvedAt!.getTime() - t.createdAt.getTime()) / (1000 * 60 * 60)).toFixed(2),
    ),
  }));
}

export async function getSlaBreachesReport(opts: ReportOptions = {}) {
  const tickets = await prisma.ticket.findMany({
    where: {
      ...ticketWhere(opts),
      OR: [{ responseBreached: true }, { resolutionBreached: true }],
    },
    select: {
      ticketNumber: true,
      title: true,
      priority: true,
      status: true,
      responseBreached: true,
      resolutionBreached: true,
      responseDueAt: true,
      resolutionDueAt: true,
      createdAt: true,
    },
  });
  return tickets;
}

export async function getMonthlyTrendsReport(opts: ReportOptions = {}) {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const where: Prisma.TicketWhereInput = { createdAt: { gte: twelveMonthsAgo } };
  if (opts.agentId) where.assignedToId = opts.agentId;

  const tickets = await prisma.ticket.findMany({
    where,
    select: { createdAt: true, status: true },
  });

  const trends: Record<string, { created: number; resolved: number; closed: number }> = {};
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo);
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    trends[key] = { created: 0, resolved: 0, closed: 0 };
  }

  tickets.forEach((t) => {
    const key = `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth() + 1).padStart(2, '0')}`;
    if (!trends[key]) return;
    trends[key].created += 1;
    if (t.status === 'RESOLVED') trends[key].resolved += 1;
    if (t.status === 'CLOSED') trends[key].closed += 1;
  });

  return Object.entries(trends).map(([month, counts]) => ({ month, ...counts }));
}

// Per-ticket audit / history log: every status change on tickets, optionally
// scoped to a single agent's assigned tickets and a date window.
export async function getTicketAuditLogReport(opts: ReportOptions = {}) {
  const where: Prisma.TicketStatusHistoryWhereInput = {};
  if (opts.agentId) where.ticket = { assignedToId: opts.agentId };
  if (opts.from || opts.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (opts.from) createdAt.gte = opts.from;
    if (opts.to) createdAt.lte = opts.to;
    where.createdAt = createdAt;
  }

  const history = await prisma.ticketStatusHistory.findMany({
    where,
    include: {
      ticket: { select: { ticketNumber: true, title: true, assignedTo: { select: { name: true } } } },
      changedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  return history.map((h) => ({
    ticketNumber: h.ticket.ticketNumber,
    title: h.ticket.title,
    agent: h.ticket.assignedTo?.name ?? 'Unassigned',
    fromStatus: h.fromStatus ?? '-',
    toStatus: h.toStatus,
    changedBy: h.changedBy?.name ?? 'System',
    note: h.note ?? '',
    date: h.createdAt,
  }));
}

// Full per-agent performance breakdown — one row per agent, downloadable.
export async function getAgentPerformanceReport(opts: ReportOptions = {}) {
  const agents = await prisma.user.findMany({
    where: opts.agentId
      ? { id: opts.agentId }
      : { role: { in: ['SUPPORT_AGENT', 'MANAGER', 'ADMIN'] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });

  const dateWindow = opts.from || opts.to ? ticketWhere({ from: opts.from, to: opts.to }) : {};
  const hrs = (start: Date, end: Date) => (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  const round = (n: number) => Number(n.toFixed(2));

  return Promise.all(
    agents.map(async (a) => {
      const base = { assignedToId: a.id, ...dateWindow };
      const [groups, resolvedTickets, respondedTickets, escalated, breaches, reopened] = await Promise.all([
        prisma.ticket.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
        prisma.ticket.findMany({ where: { ...base, resolvedAt: { not: null } }, select: { createdAt: true, resolvedAt: true } }),
        prisma.ticket.findMany({ where: { ...base, firstRespondedAt: { not: null } }, select: { createdAt: true, firstRespondedAt: true } }),
        prisma.ticket.count({ where: { ...base, escalated: true } }),
        prisma.ticket.count({ where: { ...base, OR: [{ responseBreached: true }, { resolutionBreached: true }] } }),
        prisma.ticketStatusHistory.count({ where: { toStatus: 'REOPENED', ticket: { assignedToId: a.id } } }),
      ]);

      const byStatus: Record<string, number> = {};
      let assigned = 0;
      for (const g of groups) {
        byStatus[g.status] = g._count._all;
        assigned += g._count._all;
      }
      const resolved = byStatus.RESOLVED ?? 0;
      const closed = byStatus.CLOSED ?? 0;
      const open =
        (byStatus.OPEN ?? 0) + (byStatus.ASSIGNED ?? 0) + (byStatus.IN_PROGRESS ?? 0) +
        (byStatus.PENDING_USER ?? 0) + (byStatus.REOPENED ?? 0);

      const avgResolution =
        resolvedTickets.length > 0
          ? round(resolvedTickets.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt as Date), 0) / resolvedTickets.length)
          : null;
      const avgFirstResponse =
        respondedTickets.length > 0
          ? round(respondedTickets.reduce((s, t) => s + hrs(t.createdAt, t.firstRespondedAt as Date), 0) / respondedTickets.length)
          : null;

      return {
        Agent: a.name,
        Role: a.role,
        Assigned: assigned,
        Open: open,
        Resolved: resolved,
        Closed: closed,
        Reopened: reopened,
        Escalated: escalated,
        'SLA Breaches': breaches,
        'Resolution Rate %': assigned > 0 ? round(((resolved + closed) / assigned) * 100) : 0,
        'Avg Resolution (hrs)': avgResolution ?? '-',
        'Avg First Response (hrs)': avgFirstResponse ?? '-',
      };
    }),
  );
}

export const REPORT_GENERATORS = {
  'tickets-by-category': getTicketsByCategoryReport,
  'tickets-by-agent': getTicketsByAgentReport,
  'agent-performance': getAgentPerformanceReport,
  'resolution-time': getResolutionTimeReport,
  'sla-breaches': getSlaBreachesReport,
  'monthly-trends': getMonthlyTrendsReport,
  'ticket-audit-log': getTicketAuditLogReport,
} as const;

export type ReportType = keyof typeof REPORT_GENERATORS;

// Map a named duration to a start date (relative to now). 'all' => no bound.
export function resolveDuration(duration?: string): { from?: Date } {
  if (!duration || duration === 'all') return {};
  const now = new Date();
  const from = new Date(now);
  switch (duration) {
    case 'daily':
      from.setDate(now.getDate() - 1);
      break;
    case 'weekly':
      from.setDate(now.getDate() - 7);
      break;
    case 'monthly':
      from.setMonth(now.getMonth() - 1);
      break;
    case 'annually':
      from.setFullYear(now.getFullYear() - 1);
      break;
    default:
      return {};
  }
  return { from };
}
