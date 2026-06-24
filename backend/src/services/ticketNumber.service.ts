import { prisma } from '../config/prisma';

/**
 * Generates a unique ticket number of the form TKT-<year>-<6-digit sequence>.
 * Sequence resets implicitly each year based on the count of tickets created that year.
 */
export async function generateTicketNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;

  const count = await prisma.ticket.count({
    where: { ticketNumber: { startsWith: prefix } },
  });

  let sequence = count + 1;
  let ticketNumber = `${prefix}${String(sequence).padStart(6, '0')}`;

  // Guard against race conditions causing duplicate numbers
  while (await prisma.ticket.findUnique({ where: { ticketNumber } })) {
    sequence += 1;
    ticketNumber = `${prefix}${String(sequence).padStart(6, '0')}`;
  }

  return ticketNumber;
}
