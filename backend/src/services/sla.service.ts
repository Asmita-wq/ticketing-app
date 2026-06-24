import { TicketPriority } from '@prisma/client';
import { prisma } from '../config/prisma';

const DEFAULT_SLA: Record<TicketPriority, { responseMins: number; resolutionMins: number }> = {
  CRITICAL: { responseMins: 60, resolutionMins: 240 },
  HIGH: { responseMins: 240, resolutionMins: 720 },
  MEDIUM: { responseMins: 480, resolutionMins: 1440 },
  LOW: { responseMins: 1440, resolutionMins: 4320 },
};

export async function getSlaConfig(priority: TicketPriority) {
  const config = await prisma.sLAConfiguration.findUnique({ where: { priority } });
  if (config) {
    return { responseMins: config.responseTimeMins, resolutionMins: config.resolutionTimeMins };
  }
  return DEFAULT_SLA[priority];
}

export async function computeSlaDueDates(priority: TicketPriority, from: Date = new Date()) {
  const { responseMins, resolutionMins } = await getSlaConfig(priority);
  return {
    responseDueAt: new Date(from.getTime() + responseMins * 60 * 1000),
    resolutionDueAt: new Date(from.getTime() + resolutionMins * 60 * 1000),
  };
}

/**
 * Scans open tickets and marks SLA breaches. Returns the list of newly-breached tickets
 * so the caller can send notifications.
 */
export async function detectSlaBreaches() {
  const now = new Date();

  const responseBreaches = await prisma.ticket.findMany({
    where: {
      responseBreached: false,
      firstRespondedAt: null,
      responseDueAt: { lt: now },
      status: { notIn: ['RESOLVED', 'CLOSED'] },
    },
  });

  const resolutionBreaches = await prisma.ticket.findMany({
    where: {
      resolutionBreached: false,
      resolvedAt: null,
      resolutionDueAt: { lt: now },
      status: { notIn: ['RESOLVED', 'CLOSED'] },
    },
  });

  await prisma.$transaction([
    ...responseBreaches.map((t) =>
      prisma.ticket.update({ where: { id: t.id }, data: { responseBreached: true } }),
    ),
    ...resolutionBreaches.map((t) =>
      prisma.ticket.update({ where: { id: t.id }, data: { resolutionBreached: true } }),
    ),
  ]);

  return { responseBreaches, resolutionBreaches };
}
