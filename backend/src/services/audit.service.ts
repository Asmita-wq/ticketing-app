import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

interface AuditLogInput {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  performedById?: string;
  details?: Prisma.InputJsonValue;
  ipAddress?: string;
}

export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      performedById: input.performedById,
      details: input.details,
      ipAddress: input.ipAddress,
    },
  });
}
