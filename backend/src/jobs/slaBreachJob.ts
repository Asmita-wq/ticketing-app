import { NotificationType } from '@prisma/client';
import { detectSlaBreaches } from '../services/sla.service';
import { notifyMany } from '../services/notification.service';
import { logger } from '../utils/logger';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export function startSlaBreachJob() {
  setInterval(async () => {
    try {
      const { responseBreaches, resolutionBreaches } = await detectSlaBreaches();
      const breached = [...responseBreaches, ...resolutionBreaches];

      if (breached.length === 0) return;

      const notifications = breached
        .filter((t) => t.assignedToId)
        .map((t) => ({
          userId: t.assignedToId as string,
          type: NotificationType.SLA_BREACH,
          title: `SLA Breach: ${t.ticketNumber}`,
          message: `Ticket "${t.title}" has breached its SLA.`,
          ticketId: t.id,
        }));

      await notifyMany(notifications);
      logger.info(`SLA check: ${breached.length} ticket(s) breached`);
    } catch (err) {
      logger.error(`SLA breach job failed: ${(err as Error).message}`);
    }
  }, CHECK_INTERVAL_MS);
}
