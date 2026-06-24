import { UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';

export async function getUserDashboardStats(userId: string) {
  const [total, open, inProgress, resolved, closed] = await Promise.all([
    prisma.ticket.count({ where: { createdById: userId } }),
    prisma.ticket.count({ where: { createdById: userId, status: 'OPEN' } }),
    prisma.ticket.count({ where: { createdById: userId, status: 'IN_PROGRESS' } }),
    prisma.ticket.count({ where: { createdById: userId, status: 'RESOLVED' } }),
    prisma.ticket.count({ where: { createdById: userId, status: 'CLOSED' } }),
  ]);

  return {
    totalTickets: total,
    openTickets: open,
    inProgressTickets: inProgress,
    resolvedTickets: resolved,
    closedTickets: closed,
  };
}

export async function getAdminDashboardStats() {
  const [total, open, inProgress, resolved, closed, critical] = await Promise.all([
    prisma.ticket.count(),
    prisma.ticket.count({ where: { status: 'OPEN' } }),
    prisma.ticket.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.ticket.count({ where: { status: 'RESOLVED' } }),
    prisma.ticket.count({ where: { status: 'CLOSED' } }),
    prisma.ticket.count({ where: { priority: 'CRITICAL', status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
  ]);

  const byStatusRaw = await prisma.ticket.groupBy({ by: ['status'], _count: { _all: true } });
  const byStatus = byStatusRaw.map((r) => ({ status: r.status, count: r._count._all }));

  const byCategoryRaw = await prisma.ticket.groupBy({ by: ['categoryId'], _count: { _all: true } });
  const categories = await prisma.category.findMany({
    where: { id: { in: byCategoryRaw.map((r) => r.categoryId) } },
  });
  const byCategory = byCategoryRaw.map((r) => ({
    category: categories.find((c) => c.id === r.categoryId)?.name ?? 'Unknown',
    count: r._count._all,
  }));

  // Monthly trends - last 12 months
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const recentTickets = await prisma.ticket.findMany({
    where: { createdAt: { gte: twelveMonthsAgo } },
    select: { createdAt: true },
  });

  const monthlyTrends: Record<string, number> = {};
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo);
    d.setMonth(d.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyTrends[key] = 0;
  }
  recentTickets.forEach((t) => {
    const key = `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth() + 1).padStart(2, '0')}`;
    if (key in monthlyTrends) monthlyTrends[key] += 1;
  });

  // Agent performance: resolved/closed tickets per agent + avg resolution time
  const agents = await prisma.user.findMany({
    where: { role: { in: ['SUPPORT_AGENT', 'MANAGER', 'ADMIN'] } },
    select: { id: true, name: true },
  });

  const agentPerformance = await Promise.all(
    agents.map(async (agent) => {
      const assigned = await prisma.ticket.count({ where: { assignedToId: agent.id } });
      const resolvedTickets = await prisma.ticket.findMany({
        where: { assignedToId: agent.id, status: { in: ['RESOLVED', 'CLOSED'] }, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      });

      const avgResolutionMins =
        resolvedTickets.length > 0
          ? resolvedTickets.reduce((sum, t) => {
              const diff = (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000;
              return sum + diff;
            }, 0) / resolvedTickets.length
          : 0;

      return {
        agentId: agent.id,
        agentName: agent.name,
        assignedCount: assigned,
        resolvedCount: resolvedTickets.length,
        avgResolutionMins: Math.round(avgResolutionMins),
      };
    }),
  );

  return {
    cards: {
      totalTickets: total,
      openTickets: open,
      inProgressTickets: inProgress,
      resolvedTickets: resolved,
      closedTickets: closed,
      criticalTickets: critical,
    },
    charts: {
      ticketsByStatus: byStatus,
      ticketsByCategory: byCategory,
      monthlyTrends: Object.entries(monthlyTrends).map(([month, count]) => ({ month, count })),
      agentPerformance,
    },
  };
}

export async function getDashboardStats(userId: string, role: UserRole) {
  const staffRoles: UserRole[] = ['ADMIN', 'MANAGER', 'SUPPORT_AGENT'];
  if (staffRoles.includes(role)) {
    return getAdminDashboardStats();
  }
  return getUserDashboardStats(userId);
}
