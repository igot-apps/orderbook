import { prisma } from '../lib/prisma';
import { D, money } from '../lib/money';

export async function basicReports(businessId: string) {
  const orders = await prisma.order.findMany({
    where: { businessId },
    include: { delivery: true },
  });

  const payments = await prisma.payment.findMany({
    where: { businessId },
  });

  const estimatedRequests = orders.filter((o) => o.status !== 'DRAFT' && o.status !== 'CANCELLED');
  const agreed = orders.filter((o) => o.agreedTotal != null && o.status !== 'CANCELLED');
  const delivered = orders.filter((o) =>
    ['DELIVERED', 'COMPLETED'].includes(o.status)
  );
  const cancelled = orders.filter((o) => o.status === 'CANCELLED');

  const sumField = (rows: typeof orders, field: 'estimatedTotal' | 'agreedTotal' | 'outstandingBalance' | 'estimatedDeliveryCharge') =>
    money(
      rows.reduce((s, o) => {
        const v = o[field];
        return s.plus(D(v ?? 0));
      }, D(0))
    );

  const deliveryCharges = money(
    agreed.reduce((s, o) => {
      // use locked revision delivery if possible — fallback estimated
      return s.plus(D(o.estimatedDeliveryCharge ?? 0));
    }, D(0))
  );

  // Better delivery charges from locked revisions
  const lockedRevs = await prisma.orderRevision.findMany({
    where: { isLocked: true, order: { businessId } },
  });
  const agreedDeliveryCharges = money(
    lockedRevs.reduce((s, r) => s.plus(D(r.deliveryCharge)), D(0))
  );

  const verifiedPayments = money(
    payments.reduce((s, p) => s.plus(D(p.amount)), D(0))
  );

  const outstanding = sumField(
    orders.filter((o) => D(o.outstandingBalance).gt(0)),
    'outstandingBalance'
  );

  return {
    estimatedOrderRequests: {
      count: estimatedRequests.length,
      total: sumField(estimatedRequests, 'estimatedTotal'),
    },
    agreedSales: {
      count: agreed.length,
      total: sumField(agreed, 'agreedTotal'),
    },
    deliveredSales: {
      count: delivered.length,
      total: sumField(delivered, 'agreedTotal'),
    },
    verifiedPaymentsReceived: {
      count: payments.length,
      total: verifiedPayments,
    },
    outstandingDebts: {
      count: orders.filter((o) => D(o.outstandingBalance).gt(0)).length,
      total: outstanding,
    },
    deliveryCharges: {
      total: agreedDeliveryCharges,
      estimatedFallback: deliveryCharges,
    },
    cancelledOrders: {
      count: cancelled.length,
      total: sumField(cancelled, 'estimatedTotal'),
    },
  };
}

export async function getSettings(businessId: string) {
  return prisma.businessSettings.findUnique({ where: { businessId } });
}

export async function updateSettings(
  businessId: string,
  data: {
    approvalToleranceAbs?: string | number;
    approvalTolerancePct?: string | number;
    defaultDeliveryCharge?: string | number;
  }
) {
  return prisma.businessSettings.update({
    where: { businessId },
    data: {
      approvalToleranceAbs:
        data.approvalToleranceAbs != null
          ? money(data.approvalToleranceAbs)
          : undefined,
      approvalTolerancePct:
        data.approvalTolerancePct != null
          ? money(data.approvalTolerancePct)
          : undefined,
      defaultDeliveryCharge:
        data.defaultDeliveryCharge != null
          ? money(data.defaultDeliveryCharge)
          : undefined,
    },
  });
}
