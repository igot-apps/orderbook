import { PaymentNetwork, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { D, money } from '../lib/money';
import { badRequest, notFound, conflict } from '../lib/errors';
import { writeAudit } from './auditService';
import { createNotification } from './notificationService';
import { assertTransition } from '../lib/orderState';

function receiptNumber() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `RCPT-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function getPaymentPage(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      business: true,
      payments: { orderBy: { paidAt: 'desc' } },
      paymentAttempts: { orderBy: { createdAt: 'desc' }, take: 5 },
      agreements: { orderBy: { agreedAt: 'desc' }, take: 1 },
    },
  });
  if (!order) throw notFound('Order not found');
  if (!order.agreedTotal || !['AGREED', 'DELIVERED', 'COMPLETED'].includes(order.status)) {
    throw badRequest('Order is not ready for payment');
  }

  return {
    orderId: order.id,
    businessId: order.businessId,
    customerId: order.customerId,
    orderNumber: order.orderNumber,
    businessName: order.business.name,
    customerName: order.customer.name,
    customerPhone: order.customer.phone,
    status: order.status,
    finalTotal: money(order.agreedTotal),
    amountPaid: money(order.amountPaid),
    outstandingBalance: money(order.outstandingBalance),
    isPaid: order.isPaid,
    payments: order.payments.map((p) => ({
      id: p.id,
      amount: money(p.amount),
      network: p.network,
      receiptNumber: p.receiptNumber,
      paidAt: p.paidAt,
      providerReference: p.providerReference,
    })),
    recentAttempts: order.paymentAttempts.map((a) => ({
      id: a.id,
      internalReference: a.internalReference,
      amount: money(a.amount),
      status: a.status,
      network: a.network,
      createdAt: a.createdAt,
    })),
  };
}

export async function initiatePayment(params: {
  orderId: string;
  amount: string | number;
  network: PaymentNetwork;
  momoPhone: string;
  businessId?: string;
  actorId?: string;
}) {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: { customer: true },
  });
  if (!order) throw notFound('Order not found');
  if (params.businessId && order.businessId !== params.businessId) throw notFound('Order not found');
  if (!order.agreedTotal || !['AGREED', 'DELIVERED', 'COMPLETED'].includes(order.status)) {
    throw badRequest('Order is not ready for payment');
  }
  if (order.isPaid) throw badRequest('Order is already fully paid');

  const amount = money(params.amount);
  if (D(amount).lte(0)) throw badRequest('Amount must be positive');
  if (D(amount).gt(D(order.outstandingBalance))) {
    throw badRequest('Amount exceeds outstanding balance');
  }
  if (!params.momoPhone?.trim()) throw badRequest('Mobile Money number required');

  const internalReference = `OPPAY-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;

  const attempt = await prisma.paymentAttempt.create({
    data: {
      businessId: order.businessId,
      orderId: order.id,
      internalReference,
      network: params.network,
      momoPhone: params.momoPhone.replace(/\s+/g, ''),
      amount,
      status: 'PENDING',
    },
  });

  await writeAudit({
    businessId: order.businessId,
    actorId: params.actorId,
    entityType: 'PaymentAttempt',
    entityId: attempt.id,
    action: 'INITIATE',
    details: { amount, network: params.network, internalReference },
  });

  return {
    attemptId: attempt.id,
    internalReference: attempt.internalReference,
    amount: money(attempt.amount),
    status: attempt.status,
    network: attempt.network,
    momoPhone: attempt.momoPhone,
    orderId: order.id,
    orderNumber: order.orderNumber,
  };
}

/**
 * Simulated provider webhook. Idempotent on providerReference.
 */
export async function processWebhook(params: {
  internalReference: string;
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  providerReference?: string;
  failureReason?: string;
}) {
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { internalReference: params.internalReference },
    include: {
      order: { include: { customer: true } },
      payment: true,
    },
  });
  if (!attempt) throw notFound('Payment attempt not found');

  // Already terminal + payment exists → idempotent success replay
  if (params.status === 'SUCCESS' && attempt.payment) {
    return {
      idempotent: true,
      paymentId: attempt.payment.id,
      attemptId: attempt.id,
      status: 'SUCCESS',
      message: 'Webhook already processed',
    };
  }

  if (attempt.status !== 'PENDING' && params.status !== 'SUCCESS') {
    return {
      idempotent: true,
      attemptId: attempt.id,
      status: attempt.status,
      message: 'Attempt already finalized',
    };
  }

  if (params.status === 'FAILED' || params.status === 'CANCELLED') {
    const updated = await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: params.status,
        failureReason: params.failureReason || params.status,
        completedAt: new Date(),
        webhookPayload: params as unknown as Prisma.InputJsonValue,
      },
    });

    await createNotification({
      businessId: attempt.businessId,
      recipientPhone: attempt.order.customer.phone,
      type: 'PAYMENT_FAILED',
      orderId: attempt.orderId,
      message: `OrderProof: Payment of GH₵${money(attempt.amount)} for ${attempt.order.orderNumber} ${params.status.toLowerCase()}. You can try again.`,
      linkPath: `/pay/${attempt.orderId}`,
    });

    return {
      idempotent: false,
      attemptId: updated.id,
      status: updated.status,
    };
  }

  // SUCCESS
  const providerReference =
    params.providerReference ||
    attempt.providerReference ||
    `MOMO-${randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()}`;

  // If another success already used this provider ref, short-circuit
  const existingByProvider = await prisma.payment.findUnique({
    where: { providerReference },
  });
  if (existingByProvider) {
    return {
      idempotent: true,
      paymentId: existingByProvider.id,
      attemptId: attempt.id,
      status: 'SUCCESS',
      message: 'Provider reference already recorded',
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    // Re-read attempt inside transaction
    const fresh = await tx.paymentAttempt.findUnique({
      where: { id: attempt.id },
      include: { payment: true, order: true },
    });
    if (!fresh) throw notFound('Attempt missing');
    if (fresh.payment) {
      return { payment: fresh.payment, idempotent: true };
    }

    const order = await tx.order.findUnique({ where: { id: fresh.orderId } });
    if (!order || !order.agreedTotal || !['AGREED', 'DELIVERED', 'COMPLETED'].includes(order.status)) {
      throw badRequest('Order not payable');
    }

    const payAmount = money(fresh.amount);
    if (D(payAmount).gt(D(order.outstandingBalance))) {
      throw badRequest('Payment exceeds outstanding balance at verification time');
    }

    const rcpt = receiptNumber();

    const updatedAttempt = await tx.paymentAttempt.update({
      where: { id: fresh.id },
      data: {
        status: 'SUCCESS',
        providerReference,
        receiptNumber: rcpt,
        completedAt: new Date(),
        webhookPayload: params as unknown as Prisma.InputJsonValue,
      },
    });

    const payment = await tx.payment.create({
      data: {
        businessId: fresh.businessId,
        orderId: fresh.orderId,
        attemptId: fresh.id,
        providerReference,
        network: fresh.network,
        momoPhone: fresh.momoPhone,
        amount: payAmount,
        receiptNumber: rcpt,
      },
    });

    await tx.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        orderId: fresh.orderId,
        amount: payAmount,
      },
    });

    const newPaid = money(D(order.amountPaid).plus(D(payAmount)));
    const newOutstanding = money(D(order.agreedTotal).minus(D(newPaid)));
    const isPaid = D(newOutstanding).lte(0);

    const orderUpdate: Prisma.OrderUpdateInput = {
      amountPaid: newPaid,
      outstandingBalance: D(newOutstanding).lt(0) ? money(0) : newOutstanding,
      isPaid,
    };

    // If delivered and now paid → complete
    if (isPaid && order.status === 'DELIVERED') {
      assertTransition('DELIVERED', 'COMPLETED');
      orderUpdate.status = 'COMPLETED';
      orderUpdate.completedAt = new Date();
    }

    await tx.order.update({
      where: { id: order.id },
      data: orderUpdate,
    });

    return { payment, attempt: updatedAttempt, idempotent: false, isPaid, newOutstanding };
  });

  if (!result.idempotent) {
    await writeAudit({
      businessId: attempt.businessId,
      entityType: 'Payment',
      entityId: result.payment.id,
      action: 'VERIFIED',
      details: {
        amount: money(result.payment.amount),
        providerReference,
        internalReference: attempt.internalReference,
      },
    });

    await createNotification({
      businessId: attempt.businessId,
      recipientPhone: attempt.order.customer.phone,
      type: 'PAYMENT_SUCCESS',
      orderId: attempt.orderId,
      paymentId: result.payment.id,
      message: `OrderProof: Payment of GH₵${money(result.payment.amount)} received for ${attempt.order.orderNumber}. Receipt ${result.payment.receiptNumber}.`,
      linkPath: `/customer/receipts/${result.payment.id}`,
    });
  }

  return {
    idempotent: result.idempotent,
    paymentId: result.payment.id,
    attemptId: attempt.id,
    status: 'SUCCESS' as const,
    receiptNumber: result.payment.receiptNumber,
    amount: money(result.payment.amount),
  };
}

export async function simulateWebhook(
  attemptId: string,
  action: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'RESEND',
  opts?: { providerReference?: string; failureReason?: string }
) {
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { id: attemptId },
  });
  if (!attempt) throw notFound('Payment attempt not found');

  if (action === 'RESEND') {
    if (!attempt.providerReference && attempt.status !== 'SUCCESS') {
      // resend success with stable provider ref if one was stored in payload
      const payload = attempt.webhookPayload as { providerReference?: string } | null;
      return processWebhook({
        internalReference: attempt.internalReference,
        status: 'SUCCESS',
        providerReference: payload?.providerReference || attempt.providerReference || undefined,
      });
    }
    return processWebhook({
      internalReference: attempt.internalReference,
      status: 'SUCCESS',
      providerReference: attempt.providerReference || undefined,
    });
  }

  if (action === 'SUCCESS') {
    return processWebhook({
      internalReference: attempt.internalReference,
      status: 'SUCCESS',
      providerReference: opts?.providerReference,
    });
  }

  return processWebhook({
    internalReference: attempt.internalReference,
    status: action,
    failureReason: opts?.failureReason,
  });
}

export async function listPayments(businessId: string) {
  const payments = await prisma.payment.findMany({
    where: { businessId },
    include: {
      order: { select: { orderNumber: true, id: true } },
      attempt: true,
    },
    orderBy: { paidAt: 'desc' },
    take: 100,
  });

  return payments.map((p) => ({
    id: p.id,
    orderId: p.orderId,
    orderNumber: p.order.orderNumber,
    amount: money(p.amount),
    network: p.network,
    momoPhone: p.momoPhone,
    receiptNumber: p.receiptNumber,
    providerReference: p.providerReference,
    paidAt: p.paidAt,
  }));
}

export async function listAttempts(businessId: string, status?: string) {
  const attempts = await prisma.paymentAttempt.findMany({
    where: {
      businessId,
      ...(status ? { status: status as any } : {}),
    },
    include: {
      order: { select: { orderNumber: true, id: true } },
      payment: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return attempts.map((a) => ({
    id: a.id,
    orderId: a.orderId,
    orderNumber: a.order.orderNumber,
    internalReference: a.internalReference,
    providerReference: a.providerReference,
    amount: money(a.amount),
    status: a.status,
    network: a.network,
    momoPhone: a.momoPhone,
    receiptNumber: a.receiptNumber,
    createdAt: a.createdAt,
    completedAt: a.completedAt,
    hasPayment: !!a.payment,
  }));
}

export async function getReceipt(paymentId: string, businessId?: string) {
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      ...(businessId ? { businessId } : {}),
    },
    include: {
      order: {
        include: {
          customer: true,
          business: true,
          agreements: { orderBy: { agreedAt: 'desc' }, take: 1 },
          revisions: {
            where: { isLocked: true },
            orderBy: { revisionNumber: 'desc' },
            take: 1,
            include: { items: true },
          },
        },
      },
      allocations: true,
      attempt: true,
    },
  });
  if (!payment) throw notFound('Receipt not found');

  return {
    receiptNumber: payment.receiptNumber,
    paidAt: payment.paidAt,
    amount: money(payment.amount),
    network: payment.network,
    momoPhone: payment.momoPhone,
    providerReference: payment.providerReference,
    internalReference: payment.attempt.internalReference,
    businessName: payment.order.business.name,
    customerName: payment.order.customer.name,
    customerPhone: payment.order.customer.phone,
    orderNumber: payment.order.orderNumber,
    orderId: payment.orderId,
    orderAgreedTotal: payment.order.agreedTotal ? money(payment.order.agreedTotal) : null,
    orderAmountPaid: money(payment.order.amountPaid),
    orderOutstanding: money(payment.order.outstandingBalance),
    isOrderPaid: payment.order.isPaid,
    items: payment.order.revisions[0]?.items
      .filter((i) => !i.isRemoved)
      .map((i) => ({
        name: i.productNameSnapshot,
        variant: i.variantNameSnapshot,
        quantity: i.actualQuantity.toString(),
        unit: i.unitSnapshot,
        unitPrice: money(i.confirmedUnitPrice),
        lineTotal: money(i.actualLineTotal),
      })),
  };
}

export async function customerPaymentHistory(businessId: string, customerId: string) {
  const payments = await prisma.payment.findMany({
    where: {
      businessId,
      order: { customerId },
    },
    include: {
      order: { select: { orderNumber: true, id: true } },
    },
    orderBy: { paidAt: 'desc' },
  });

  return payments.map((p) => ({
    id: p.id,
    orderId: p.orderId,
    orderNumber: p.order.orderNumber,
    amount: money(p.amount),
    network: p.network,
    receiptNumber: p.receiptNumber,
    paidAt: p.paidAt,
  }));
}
