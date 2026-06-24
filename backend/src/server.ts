import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './config/prisma';
import { logger } from './utils/logger';
import { startSlaBreachJob } from './jobs/slaBreachJob';
import { startEmailPollingJob } from './jobs/emailPollingJob';

async function main() {
  await prisma.$connect();
  logger.info('Database connected');

  const app = createApp();

  app.listen(env.port, () => {
    logger.info(`Server running on port ${env.port} [${env.nodeEnv}]`);
  });

  startSlaBreachJob();
  startEmailPollingJob();
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
