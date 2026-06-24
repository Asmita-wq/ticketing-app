import { z } from 'zod';
import { TicketPriority, TicketStatus } from '@prisma/client';

export const createTicketSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(10),
  categoryId: z.string().uuid(),
  subcategoryId: z.string().uuid().optional(),
  priority: z.nativeEnum(TicketPriority).default('MEDIUM'),
  contactName: z.string().max(100).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(20).optional(),
  // Staff only: raise the ticket on behalf of this user (becomes the ticket owner)
  onBehalfOfUserId: z.string().uuid().optional(),
  // Values for admin-defined custom fields, keyed by field id
  customData: z.record(z.string(), z.string()).optional(),
});

export const updateTicketSchema = z.object({
  title: z.string().min(5).max(200).optional(),
  description: z.string().min(10).optional(),
  categoryId: z.string().uuid().optional(),
  subcategoryId: z.string().uuid().optional(),
  contactName: z.string().max(100).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(20).optional(),
});

export const assignTicketSchema = z.object({
  assignedToId: z.string().uuid(),
  note: z.string().max(500).optional(),
});

export const bulkAssignSchema = z.object({
  ticketIds: z.array(z.string().uuid()).min(1).max(200),
  assignedToId: z.string().uuid(),
});

export const changeStatusSchema = z.object({
  status: z.nativeEnum(TicketStatus),
  note: z.string().max(500).optional(),
});

export const changePrioritySchema = z.object({
  priority: z.nativeEnum(TicketPriority),
});

export const escalateSchema = z.object({
  // Note is optional — agents can escalate without a lengthy description
  note: z.string().max(500).optional(),
});

export const mergeSchema = z.object({
  sourceTicketIds: z.array(z.string().uuid()).min(1),
});

export const listTicketsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  categoryId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  search: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'status', 'ticketNumber']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
