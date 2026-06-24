import { z } from 'zod';
import { UserRole } from '@prisma/client';

export const createAgentSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  // Optional — if omitted, the server generates a strong random password and emails it.
  password: z.string().min(8).max(72).optional(),
  phone: z.string().min(7).max(20).optional(),
  role: z.nativeEnum(UserRole).default('SUPPORT_AGENT'),
  department: z.string().max(100).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  phone: z.string().min(7).max(20).optional(),
  department: z.string().max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});
