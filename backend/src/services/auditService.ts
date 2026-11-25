import { prisma } from '../lib/prisma';

export async function writeAudit(params: {
  businessId: string;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  details?: unknown;
}) {
  return prisma.auditLog.create({
    data: {
      businessId: params.businessId,
      actorId: params.actorId ?? null,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      details: params.details as object | undefined,
    },
  });
}
