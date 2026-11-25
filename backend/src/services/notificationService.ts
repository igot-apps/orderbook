import { NotificationType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export async function createNotification(params: {
  businessId: string;
  recipientPhone: string;
  type: NotificationType;
  message: string;
  orderId?: string;
  paymentId?: string;
  linkPath?: string;
}) {
  const record = await prisma.notification.create({
    data: {
      businessId: params.businessId,
      recipientPhone: params.recipientPhone,
      type: params.type,
      message: params.message,
      orderId: params.orderId,
      paymentId: params.paymentId,
      linkPath: params.linkPath,
      status: 'SENT',
      sentAt: new Date(),
    },
  });

  return record;
}

export async function listCustomerNotifications(phone: string, businessId: string) {
  return prisma.notification.findMany({
    where: { recipientPhone: phone, businessId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      order: { select: { id: true, orderNumber: true, status: true } },
    },
  });
}

export type TxClient = Prisma.TransactionClient;
