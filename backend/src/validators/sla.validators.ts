import { z } from 'zod';
import { TicketPriority } from '@prisma/client';

export const upsertSlaSchema = z.object({
  priority: z.nativeEnum(TicketPriority),
  responseTimeMins: z.number().int().positive(),
  resolutionTimeMins: z.number().int().positive(),
});
