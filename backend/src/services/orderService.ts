import {
  AgreementMethod,
  OrderStatus,
  PricingType,
  SellingUnit,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  actualLineTotal,
  D,
  difference,
  estimatedQuantity,
  money,
  qty,
  sumMoney,
} from '../lib/money';
import { assertTransition } from '../lib/orderState';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { writeAudit } from './auditService';
import { createNotification } from './notificationService';

function serializeOrder(order: any) {
  return {
    ...order,
    estimatedDeliveryCharge: money(order.estimatedDeliveryCharge),
    requestedItemsTotal: money(order.requestedItemsTotal),
    estimatedTotal: money(order.estimatedTotal),
    agreedTotal: order.agreedTotal != null ? money(order.agreedTotal) : null,
    amountPaid: money(order.amountPaid),
    outstandingBalance: money(order.outstandingBalance),
    requestItems: order.requestItems?.map((i: any) => ({
      ...i,
      catalogueUnitPrice: money(i.catalogueUnitPrice),
      requestedAmount: money(i.requestedAmount),
      estimatedQuantity: qty(i.estimatedQuantity),
    })),
    revisions: order.revisions?.map((r: any) => serializeRevision(r)),
    agreements: order.agreements?.map((a: any) => ({
      ...a,
      agreedTotal: money(a.agreedTotal),
    })),
    paymentAttempts: order.paymentAttempts?.map((p: any) => ({
      ...p,
      amount: money(p.amount),
    })),
    payments: order.payments?.map((p: any) => ({
      ...p,
      amount: money(p.amount),
      allocations: p.allocations?.map((al: any) => ({
        ...al,
        amount: money(al.amount),
      })),
    })),
  };
}

function serializeRevision(r: any) {
  return {
    ...r,
    deliveryCharge: money(r.deliveryCharge),
    itemsTotal: money(r.itemsTotal),
    grandTotal: money(r.grandTotal),
    requestedTotal: money(r.requestedTotal),
    differenceAmount: money(r.differenceAmount),
    differencePercent: D(r.differencePercent).toFixed(2),
    items: r.items?.map((i: any) => ({
      ...i,
      catalogueUnitPrice: money(i.catalogueUnitPrice),
      confirmedUnitPrice: money(i.confirmedUnitPrice),
      requestedAmount: money(i.requestedAmount),
      estimatedQuantity: qty(i.estimatedQuantity),
      actualQuantity: qty(i.actualQuantity),
      actualLineTotal: money(i.actualLineTotal),
      differenceAmount: money(i.differenceAmount),
    })),
    agreement: r.agreement
      ? { ...r.agreement, agreedTotal: money(r.agreement.agreedTotal) }
      : null,
  };
}

async function nextOrderNumber(businessId: string): Promise<string> {
  const count = await prisma.order.count({ where: { businessId } });
  return `OP-${String(count + 1).padStart(5, '0')}`;
}

export async function listOrders(params: {
  businessId: string;
  customerId?: string;
  status?: OrderStatus | OrderStatus[];
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const where: any = { businessId: params.businessId };
  if (params.customerId) where.customerId = params.customerId;
  if (params.status) {
    where.status = Array.isArray(params.status)
      ? { in: params.status }
      : params.status;
  }
  if (params.q) {
    where.OR = [
      { orderNumber: { contains: params.q, mode: 'insensitive' } },
      { customer: { name: { contains: params.q, mode: 'insensitive' } } },
      { customer: { phone: { contains: params.q } } },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    include: params.page ? { customer: true } : {
      customer: true,
      requestItems: true,
      revisions: { orderBy: { revisionNumber: 'desc' }, take: 1, include: { items: true, agreement: true } },
      delivery: true,
      agreements: { orderBy: { agreedAt: 'desc' }, take: 1 },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(params.page ? { skip: (params.page - 1) * (params.pageSize || 25), take: (params.pageSize || 25) + 1 } : {}),
  });

  return orders.map(serializeOrder);
}

export async function getOrder(
  businessId: string,
  orderId: string,
  opts?: { customerId?: string }
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      businessId,
      ...(opts?.customerId ? { customerId: opts.customerId } : {}),
    },
    include: {
      customer: true,
      requestItems: { orderBy: { sortOrder: 'asc' } },
      revisions: {
        orderBy: { revisionNumber: 'asc' },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          agreement: { include: { recordedBy: { select: { id: true, name: true } } } },
          preparedBy: { select: { id: true, name: true } },
        },
      },
      agreements: {
        include: { recordedBy: { select: { id: true, name: true } }, revision: true },
        orderBy: { agreedAt: 'asc' },
      },
      delivery: true,
      paymentAttempts: { orderBy: { createdAt: 'desc' } },
      payments: {
        include: { allocations: true },
        orderBy: { paidAt: 'desc' },
      },
      notifications: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!order) throw notFound('Order not found');

  const timeline = await buildTimeline(order);
  return { ...serializeOrder(order), timeline };
}

async function buildTimeline(order: any) {
  const events: Array<{ at: string; type: string; title: string; detail?: string; actor?: string }> = [];

  events.push({
    at: order.createdAt.toISOString(),
    type: 'CREATED',
    title: 'Order created',
  });

  if (order.submittedAt) {
    events.push({
      at: order.submittedAt.toISOString(),
      type: 'SUBMITTED',
      title: 'Order submitted',
      detail: `Estimated total ${money(order.estimatedTotal)}`,
    });
  }

  for (const rev of order.revisions ?? []) {
    if (rev.sentForApprovalAt) {
      events.push({
        at: rev.sentForApprovalAt.toISOString(),
        type: 'REVISION_SENT',
        title: `Revision #${rev.revisionNumber} sent for approval`,
        detail: `Prepared total ${money(rev.grandTotal)} (diff ${money(rev.differenceAmount)})`,
        actor: rev.preparedBy?.name,
      });
    } else {
      events.push({
        at: rev.createdAt.toISOString(),
        type: 'REVISION_SAVED',
        title: `Revision #${rev.revisionNumber} saved`,
        actor: rev.preparedBy?.name,
      });
    }
    if (rev.changeRequestNote) {
      events.push({
        at: rev.createdAt.toISOString(),
        type: 'CHANGE_REQUESTED',
        title: 'Customer requested a change',
        detail: rev.changeRequestNote,
      });
    }
  }

  for (const ag of order.agreements ?? []) {
    events.push({
      at: ag.agreedAt.toISOString(),
      type: 'AGREED',
      title:
        ag.method === 'DIGITAL'
          ? 'Customer accepted digitally'
          : ag.method === 'PHONE'
            ? 'Seller recorded telephone approval'
            : 'Auto-finalized within tolerance',
      detail: `Invoice total ${money(ag.agreedTotal)}`,
      actor: ag.recordedBy?.name,
    });
  }

  for (const attempt of order.paymentAttempts ?? []) {
    events.push({
      at: attempt.createdAt.toISOString(),
      type: 'PAYMENT_ATTEMPT',
      title: `Payment attempt ${attempt.status}`,
      detail: `${money(attempt.amount)} via ${attempt.network} (${attempt.internalReference})`,
    });
  }

  for (const pay of order.payments ?? []) {
    events.push({
      at: pay.paidAt.toISOString(),
      type: 'PAYMENT_VERIFIED',
      title: 'Payment verified',
      detail: `${money(pay.amount)} · Receipt ${pay.receiptNumber}`,
    });
  }

  if (order.delivery?.dispatchedAt) {
    events.push({
      at: order.delivery.dispatchedAt.toISOString(),
      type: 'DISPATCHED',
      title: 'Order dispatched',
    });
  }
  if (order.delivery?.deliveredAt) {
    events.push({
      at: order.delivery.deliveredAt.toISOString(),
      type: 'DELIVERED',
      title: 'Order delivered',
    });
  }

  for (const n of order.notifications ?? []) {
    events.push({
      at: n.createdAt.toISOString(),
      type: `NOTIFICATION_${n.type}`,
      title: `Update: ${n.type.replace(/_/g, ' ').toLowerCase()}`,
      detail: n.message.slice(0, 120),
    });
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

type RequestItemInput = {
  productId?: string;
  variantId?: string;
  isCustom?: boolean;
  customName?: string;
  customUnit?: SellingUnit;
  requestedAmount: string | number;
  note?: string;
};

export async function createAndSubmitOrder(params: {
  businessId: string;
  customerId: string;
  actorId: string;
  items: RequestItemInput[];
  deliveryInstructions?: string;
  estimatedDeliveryCharge?: string | number;
  submit?: boolean;
}) {
  if (!params.items?.length) throw badRequest('Add at least one item');

  const customer = await prisma.customer.findFirst({
    where: { id: params.customerId, businessId: params.businessId },
  });
  if (!customer) throw notFound('Customer not found');

  const builtItems: Array<{
    productId: string | null;
    variantId: string | null;
    isCustom: boolean;
    productNameSnapshot: string;
    variantNameSnapshot: string | null;
    brandSnapshot: string | null;
    unitSnapshot: SellingUnit;
    pricingTypeSnapshot: PricingType;
    catalogueUnitPrice: string;
    requestedAmount: string;
    estimatedQuantity: string;
    note?: string;
    sortOrder: number;
  }> = [];
  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i];
    const requestedAmount = money(item.requestedAmount);
    if (D(requestedAmount).lte(0)) throw badRequest('Requested amount must be positive');

    if (item.isCustom || !item.variantId) {
      const name = item.customName?.trim();
      if (!name) throw badRequest('Custom item name required');
      const unit = item.customUnit || 'PIECE';
      builtItems.push({
        productId: null as string | null,
        variantId: null as string | null,
        isCustom: true,
        productNameSnapshot: name,
        variantNameSnapshot: null as string | null,
        brandSnapshot: null as string | null,
        unitSnapshot: unit,
        pricingTypeSnapshot: 'FIXED_UNIT' as PricingType,
        catalogueUnitPrice: requestedAmount,
        requestedAmount,
        estimatedQuantity: qty(1),
        note: item.note,
        sortOrder: i,
      });
      continue;
    }

    const variant = await prisma.productVariant.findFirst({
      where: { id: item.variantId, isActive: true },
      include: { product: true },
    });
    if (!variant || variant.product.businessId !== params.businessId) {
      throw badRequest(`Variant not found: ${item.variantId}`);
    }
    if (variant.product.isArchived) throw badRequest(`${variant.product.name} is archived`);

    const unitPrice = money(variant.unitPrice);
    const estQty = estimatedQuantity(requestedAmount, unitPrice);

    builtItems.push({
      productId: variant.productId,
      variantId: variant.id,
      isCustom: false,
      productNameSnapshot: variant.product.name,
      variantNameSnapshot: variant.name,
      brandSnapshot: variant.brand,
      unitSnapshot: variant.unit,
      pricingTypeSnapshot: variant.pricingType,
      catalogueUnitPrice: unitPrice,
      requestedAmount,
      estimatedQuantity: qty(estQty),
      note: item.note,
      sortOrder: i,
    });
  }

  const requestedItemsTotal = money(sumMoney(builtItems.map((b) => b.requestedAmount)));
  const deliveryCharge = money(params.estimatedDeliveryCharge ?? 0);
  if (D(deliveryCharge).lt(0)) throw badRequest('Delivery charge cannot be negative');
  const estimatedTotal = money(D(requestedItemsTotal).plus(D(deliveryCharge)));
  const orderNumber = await nextOrderNumber(params.businessId);
  const submit = params.submit !== false;

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        businessId: params.businessId,
        customerId: params.customerId,
        orderNumber,
        status: submit ? 'SUBMITTED' : 'DRAFT',
        deliveryInstructions: params.deliveryInstructions,
        estimatedDeliveryCharge: deliveryCharge,
        requestedItemsTotal,
        estimatedTotal,
        submittedAt: submit ? new Date() : null,
        requestItems: { create: builtItems },
      },
      include: { requestItems: true, customer: true },
    });

    // bump product usage
    const productIds = [
      ...new Set(builtItems.map((b) => b.productId).filter(Boolean) as string[]),
    ];
    for (const pid of productIds) {
      await tx.product.update({
        where: { id: pid },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    }

    return created;
  });

  await writeAudit({
    businessId: params.businessId,
    actorId: params.actorId,
    entityType: 'Order',
    entityId: order.id,
    action: submit ? 'SUBMIT' : 'CREATE_DRAFT',
    details: { orderNumber, estimatedTotal },
  });

  if (submit) {
    await createNotification({
      businessId: params.businessId,
      recipientPhone: order.customer.phone,
      type: 'ORDER_RECEIVED',
      orderId: order.id,
      message: `OrderProof: We received order ${order.orderNumber}. Estimated total ${formatMsg(estimatedTotal)}. Your order is being prepared.`,
      linkPath: `/customer/orders/${order.id}`,
    });
  }

  return serializeOrder(order);
}

function formatMsg(v: string) {
  return `GH₵${v}`;
}

export async function startPreparing(
  businessId: string,
  actorId: string,
  orderId: string
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: { requestItems: true },
  });
  if (!order) throw notFound('Order not found');
  const preparable: OrderStatus[] = [
    'SUBMITTED',
    'CHANGE_REQUESTED',
    'PREPARING',
    'AWAITING_CUSTOMER_APPROVAL',
  ];
  if (!preparable.includes(order.status)) {
    assertTransition(order.status, 'PREPARING');
  }

  if (order.status === 'SUBMITTED' || order.status === 'CHANGE_REQUESTED') {
    assertTransition(order.status, 'PREPARING');
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'PREPARING' },
    });
  }

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Order',
    entityId: orderId,
    action: 'START_PREPARING',
  });

  return getOrder(businessId, orderId);
}

type PrepItemInput = {
  requestItemId?: string;
  productNameSnapshot: string;
  variantNameSnapshot?: string;
  brandSnapshot?: string;
  unitSnapshot: SellingUnit;
  pricingTypeSnapshot: PricingType;
  catalogueUnitPrice: string | number;
  confirmedUnitPrice: string | number;
  priceChangeReason?: string;
  requestedAmount: string | number;
  estimatedQuantity: string | number;
  actualQuantity: string | number;
  isRemoved?: boolean;
  isReplacement?: boolean;
  note?: string;
};

export async function savePreparation(params: {
  businessId: string;
  actorId: string;
  orderId: string;
  items: PrepItemInput[];
  deliveryCharge?: string | number;
  preparationNote?: string;
  sendForApproval?: boolean;
}) {
  const order = await prisma.order.findFirst({
    where: { id: params.orderId, businessId: params.businessId },
    include: {
      customer: true,
      requestItems: true,
      revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 },
    },
  });
  if (!order) throw notFound('Order not found');

  if (!['SUBMITTED', 'PREPARING', 'CHANGE_REQUESTED', 'AWAITING_CUSTOMER_APPROVAL', 'AGREED'].includes(order.status)) {
    throw badRequest(`Cannot prepare order in status ${order.status}`);
  }
  if (order.status === 'AGREED' && !D(order.amountPaid).eq(0)) {
    throw badRequest('An invoice with recorded payments cannot be revised');
  }

  // Ensure PREPARING
  if (order.status === 'SUBMITTED' || order.status === 'CHANGE_REQUESTED' || order.status === 'AGREED') {
    assertTransition(order.status, 'PREPARING');
  }

  if (!params.items?.length) throw badRequest('Preparation items required');
  const originalItems = new Map(order.requestItems.map((item) => [item.id, item]));
  const suppliedIds = params.items.map((item) => item.requestItemId).filter((id): id is string => !!id);
  if (new Set(suppliedIds).size !== suppliedIds.length ||
      suppliedIds.length !== order.requestItems.length ||
      suppliedIds.some((id) => !originalItems.has(id))) {
    throw badRequest('Invoice must include each original request item exactly once');
  }
  if (params.items.some((item) => !item.requestItemId || item.isReplacement)) {
    throw badRequest('Replacement items are not supported in this invoice flow');
  }

  const built = params.items.map((item, idx) => {
    const original = originalItems.get(item.requestItemId!)!;
    if (item.isRemoved && !item.priceChangeReason?.trim()) {
      throw badRequest(`Reason required to remove ${original.productNameSnapshot}`);
    }
    const confirmed = money(item.confirmedUnitPrice);
    if (!item.isRemoved && D(confirmed).lte(0)) {
      throw badRequest(`Unit price must be positive for ${original.productNameSnapshot}`);
    }
    const catalogue = money(original.catalogueUnitPrice);
    if (!D(confirmed).eq(D(catalogue)) && !item.priceChangeReason && !item.isRemoved) {
      throw badRequest(`Price change reason required for ${item.productNameSnapshot}`);
    }
    const actualQty = item.isRemoved ? '0' : qty(item.actualQuantity);
    if (!item.isRemoved && D(actualQty).lte(0)) {
      throw badRequest(`Quantity must be positive for ${original.productNameSnapshot}`);
    }
    const lineTotal = item.isRemoved
      ? money(0)
      : money(actualLineTotal(actualQty, confirmed));
    const reqAmt = money(original.requestedAmount);
    const diff = difference(lineTotal, reqAmt);
    if ((!D(diff.amount).eq(0) || !D(actualQty).eq(D(original.estimatedQuantity))) && !item.priceChangeReason?.trim() && !item.isRemoved) {
      throw badRequest(`Adjustment reason required for ${item.productNameSnapshot}`);
    }
    return {
      requestItemId: item.requestItemId,
      productNameSnapshot: original.productNameSnapshot,
      variantNameSnapshot: original.variantNameSnapshot,
      brandSnapshot: original.brandSnapshot,
      unitSnapshot: original.unitSnapshot,
      pricingTypeSnapshot: original.pricingTypeSnapshot,
      catalogueUnitPrice: catalogue,
      confirmedUnitPrice: confirmed,
      priceChangeReason: item.priceChangeReason,
      requestedAmount: reqAmt,
      estimatedQuantity: qty(original.estimatedQuantity),
      actualQuantity: actualQty,
      actualLineTotal: lineTotal,
      differenceAmount: money(diff.amount),
      isRemoved: !!item.isRemoved,
      isReplacement: !!item.isReplacement,
      note: item.note ?? original.note,
      sortOrder: idx,
    };
  });

  const itemsTotal = money(
    sumMoney(built.filter((b) => !b.isRemoved).map((b) => b.actualLineTotal))
  );
  if (built.every((item) => item.isRemoved)) {
    throw badRequest('Cancel the order if no requested items can be supplied');
  }
  const deliveryCharge = money(params.deliveryCharge ?? order.estimatedDeliveryCharge);
  if (D(deliveryCharge).lt(0)) throw badRequest('Delivery charge cannot be negative');
  const grandTotal = money(D(itemsTotal).plus(D(deliveryCharge)));
  const requestedTotal = money(
    D(order.requestedItemsTotal).plus(D(order.estimatedDeliveryCharge))
  );
  const diff = difference(grandTotal, requestedTotal);
  const nextRevNum = (order.revisions[0]?.revisionNumber ?? 0) + 1;

  // Auto-approval is only for the exact requested invoice, not merely an equal
  // grand total. Offsetting line changes must remain visible to the customer.
  const unchangedItems = built.length === order.requestItems.length &&
    new Set(built.map((line) => line.requestItemId)).size === order.requestItems.length &&
    built.every((line) => {
      const requested = order.requestItems.find((item) => item.id === line.requestItemId);
      return requested && !line.isRemoved && !line.isReplacement &&
        line.productNameSnapshot === requested.productNameSnapshot &&
        line.variantNameSnapshot === requested.variantNameSnapshot &&
        line.unitSnapshot === requested.unitSnapshot &&
        D(line.actualQuantity).eq(D(requested.estimatedQuantity)) &&
        D(line.confirmedUnitPrice).eq(D(requested.catalogueUnitPrice)) &&
        D(line.actualLineTotal).eq(D(requested.requestedAmount));
    });
  const needsApproval = !unchangedItems ||
    !D(deliveryCharge).eq(D(order.estimatedDeliveryCharge)) ||
    !D(requestedTotal).eq(D(grandTotal));

  const send = !!params.sendForApproval;
  const autoFinalize = send && !needsApproval && order.customer.autoApproveUnchanged;

  const result = await prisma.$transaction(async (tx) => {
    if (order.status === 'SUBMITTED' || order.status === 'CHANGE_REQUESTED' || order.status === 'AGREED') {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'PREPARING',
          ...(order.status === 'AGREED' ? {
            agreedTotal: null,
            outstandingBalance: money(0),
            agreedAt: null,
            isPaid: false,
          } : {}),
        },
      });
    }

    const revision = await tx.orderRevision.create({
      data: {
        orderId: order.id,
        revisionNumber: nextRevNum,
        preparedById: params.actorId,
        deliveryCharge,
        itemsTotal,
        grandTotal,
        requestedTotal,
        differenceAmount: money(diff.amount),
        differencePercent: diff.percent.toFixed(2),
        preparationNote: params.preparationNote,
        isLocked: autoFinalize,
        sentForApprovalAt: send ? new Date() : null,
        items: { create: built },
      },
      include: { items: true },
    });

    for (const b of built) {
      if (b.priceChangeReason) {
        await tx.auditLog.create({
          data: {
            businessId: params.businessId,
            actorId: params.actorId,
            entityType: 'OrderRevisionItem',
            entityId: revision.id,
            action: 'PRICE_CHANGE',
            details: {
              product: b.productNameSnapshot,
              catalogueUnitPrice: b.catalogueUnitPrice,
              confirmedUnitPrice: b.confirmedUnitPrice,
              reason: b.priceChangeReason,
            },
          },
        });
      }
    }

    if (send && !autoFinalize) {
      assertTransition('PREPARING', 'AWAITING_CUSTOMER_APPROVAL');
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'AWAITING_CUSTOMER_APPROVAL' },
      });
    }

    if (autoFinalize) {
      await tx.orderAgreement.create({
        data: {
          orderId: order.id,
          revisionId: revision.id,
          method: 'AUTO_WITHIN_TOLERANCE',
          recordedById: params.actorId,
          agreedTotal: grandTotal,
          phoneNote: 'Automatically approved: every invoice line matches the customer request',
        },
      });
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'AGREED',
          agreedTotal: grandTotal,
          outstandingBalance: grandTotal,
          amountPaid: money(0),
          isPaid: D(grandTotal).eq(0),
          agreedAt: new Date(),
        },
      });
      await tx.delivery.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          status: 'PENDING',
          instructions: order.deliveryInstructions,
        },
        update: {},
      });
    }

    return revision;
  });

  await writeAudit({
    businessId: params.businessId,
    actorId: params.actorId,
    entityType: 'Order',
    entityId: order.id,
    action: send ? (autoFinalize ? 'AUTO_FINALIZE' : 'SEND_FOR_APPROVAL') : 'SAVE_PREPARATION',
    details: {
      revisionNumber: result.revisionNumber,
      grandTotal,
      needsApproval,
    },
  });

  if (send && !autoFinalize) {
    await createNotification({
      businessId: params.businessId,
      recipientPhone: order.customer.phone,
      type: 'AWAITING_APPROVAL',
      orderId: order.id,
      message: `OrderProof: Order ${order.orderNumber} is ready for your approval. Prepared total ${formatMsg(grandTotal)} (was ${formatMsg(requestedTotal)}). Review and accept:`,
      linkPath: `/customer/orders/${order.id}/approve`,
    });
  }

  if (autoFinalize) {
    await createNotification({
      businessId: params.businessId,
      recipientPhone: order.customer.phone,
      type: 'ORDER_FINALIZED',
      orderId: order.id,
      message: `OrderProof: Order ${order.orderNumber} finalized at ${formatMsg(grandTotal)}. Pay here:`,
      linkPath: `/pay/${order.id}`,
    });
    await createNotification({
      businessId: params.businessId,
      recipientPhone: order.customer.phone,
      type: 'PAYMENT_LINK',
      orderId: order.id,
      message: `OrderProof: Payment link for ${order.orderNumber} — ${formatMsg(grandTotal)} outstanding.`,
      linkPath: `/pay/${order.id}`,
    });
  }

  return getOrder(params.businessId, order.id);
}

export async function customerRespond(params: {
  businessId: string;
  customerId: string;
  actorId: string;
  orderId: string;
  action: 'ACCEPT' | 'REQUEST_CHANGE';
  message?: string;
}) {
  const order = await prisma.order.findFirst({
    where: {
      id: params.orderId,
      businessId: params.businessId,
      customerId: params.customerId,
    },
    include: {
      customer: true,
      revisions: {
        where: { sentForApprovalAt: { not: null } },
        orderBy: { revisionNumber: 'desc' },
        take: 1,
        include: { agreement: true },
      },
    },
  });
  if (!order) throw notFound('Order not found');
  if (order.status !== 'AWAITING_CUSTOMER_APPROVAL') {
    throw badRequest('Order is not awaiting approval');
  }
  const revision = order.revisions[0];
  if (!revision) throw badRequest('No revision pending approval');
  if (revision.agreement) throw badRequest('Revision already agreed');
  if (revision.isLocked) throw badRequest('Revision is locked');

  if (params.action === 'REQUEST_CHANGE') {
    if (!params.message?.trim()) throw badRequest('Please describe the change you need');

    await prisma.$transaction(async (tx) => {
      assertTransition('AWAITING_CUSTOMER_APPROVAL', 'CHANGE_REQUESTED');
      await tx.orderRevision.update({
        where: { id: revision.id },
        data: { changeRequestNote: params.message },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'CHANGE_REQUESTED' },
      });
    });

    await writeAudit({
      businessId: params.businessId,
      actorId: params.actorId,
      entityType: 'Order',
      entityId: order.id,
      action: 'CUSTOMER_CHANGE_REQUEST',
      details: { message: params.message, revisionId: revision.id },
    });

    await createNotification({
      businessId: params.businessId,
      recipientPhone: order.customer.phone,
      type: 'CHANGE_REQUESTED',
      orderId: order.id,
      message: `OrderProof: Change requested on ${order.orderNumber}. The seller will revise and send an update.`,
      linkPath: `/customer/orders/${order.id}`,
    });

    return getOrder(params.businessId, order.id, { customerId: params.customerId });
  }

  // ACCEPT
  const grandTotal = money(revision.grandTotal);
  await prisma.$transaction(async (tx) => {
    assertTransition('AWAITING_CUSTOMER_APPROVAL', 'AGREED');
    await tx.orderRevision.update({
      where: { id: revision.id },
      data: { isLocked: true },
    });
    await tx.orderAgreement.create({
      data: {
        orderId: order.id,
        revisionId: revision.id,
        method: 'DIGITAL',
        recordedById: params.actorId,
        customerNote: params.message,
        agreedTotal: grandTotal,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'AGREED',
        agreedTotal: grandTotal,
        outstandingBalance: grandTotal,
        amountPaid: money(0),
        isPaid: D(grandTotal).eq(0),
        agreedAt: new Date(),
      },
    });
    await tx.delivery.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        status: 'PENDING',
        instructions: order.customer ? order.deliveryInstructions : undefined,
      },
      update: {},
    });
  });

  // fix delivery instructions
  await prisma.delivery.update({
    where: { orderId: order.id },
    data: { instructions: order.deliveryInstructions },
  }).catch(() => undefined);

  await writeAudit({
    businessId: params.businessId,
    actorId: params.actorId,
    entityType: 'Order',
    entityId: order.id,
    action: 'CUSTOMER_ACCEPT',
    details: { revisionId: revision.id, agreedTotal: grandTotal },
  });

  await createNotification({
    businessId: params.businessId,
    recipientPhone: order.customer.phone,
    type: 'ORDER_FINALIZED',
    orderId: order.id,
    message: `OrderProof: You accepted order ${order.orderNumber}. Final total ${formatMsg(grandTotal)}.`,
    linkPath: `/customer/orders/${order.id}`,
  });
  await createNotification({
    businessId: params.businessId,
    recipientPhone: order.customer.phone,
    type: 'PAYMENT_LINK',
    orderId: order.id,
    message: `OrderProof: Pay ${formatMsg(grandTotal)} for ${order.orderNumber}:`,
    linkPath: `/pay/${order.id}`,
  });

  return getOrder(params.businessId, order.id, { customerId: params.customerId });
}

export async function flagAgreedPrice(params: {
  businessId: string;
  customerId: string;
  actorId: string;
  orderId: string;
  message: string;
}) {
  if (!params.message?.trim()) throw badRequest('Please explain the price issue');
  const order = await prisma.order.findFirst({
    where: {
      id: params.orderId,
      businessId: params.businessId,
      customerId: params.customerId,
    },
    include: {
      customer: true,
      business: true,
      revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 },
    },
  });
  if (!order) throw notFound('Order not found');
  if (order.status !== 'AGREED') throw badRequest('Only an agreed order can be flagged');
  if (!D(order.amountPaid).eq(0)) {
    throw badRequest('Contact the seller directly because a payment has already been recorded');
  }
  const revision = order.revisions[0];
  if (!revision) throw badRequest('No agreed revision found');

  await prisma.$transaction(async (tx) => {
    assertTransition('AGREED', 'CHANGE_REQUESTED');
    await tx.orderRevision.update({
      where: { id: revision.id },
      data: { changeRequestNote: params.message.trim() },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'CHANGE_REQUESTED',
        agreedTotal: null,
        outstandingBalance: money(0),
        agreedAt: null,
      },
    });
  });

  await writeAudit({
    businessId: params.businessId,
    actorId: params.actorId,
    entityType: 'Order',
    entityId: order.id,
    action: 'CUSTOMER_FLAG_PRICE',
    details: { message: params.message.trim(), revisionId: revision.id },
  });

  return getOrder(params.businessId, order.id, { customerId: params.customerId });
}

export async function recordPhoneAgreement(params: {
  businessId: string;
  actorId: string;
  orderId: string;
  note: string;
  revisionId?: string;
}) {
  if (!params.note?.trim()) throw badRequest('Phone approval note is required');

  const order = await prisma.order.findFirst({
    where: { id: params.orderId, businessId: params.businessId },
    include: {
      customer: true,
      revisions: {
        where: { sentForApprovalAt: { not: null } },
        orderBy: { revisionNumber: 'desc' },
        take: 1,
        include: { agreement: true },
      },
    },
  });
  if (!order) throw notFound('Order not found');
  if (order.status !== 'AWAITING_CUSTOMER_APPROVAL') {
    throw badRequest('Order is not awaiting approval');
  }

  const revision =
    (params.revisionId
      ? await prisma.orderRevision.findFirst({
          where: { id: params.revisionId, orderId: order.id },
          include: { agreement: true },
        })
      : order.revisions[0]) ?? null;

  if (!revision) throw badRequest('No revision to agree');
  if (revision.agreement || revision.isLocked) throw badRequest('Revision already locked');

  const grandTotal = money(revision.grandTotal);

  await prisma.$transaction(async (tx) => {
    assertTransition('AWAITING_CUSTOMER_APPROVAL', 'AGREED');
    await tx.orderRevision.update({
      where: { id: revision.id },
      data: { isLocked: true },
    });
    await tx.orderAgreement.create({
      data: {
        orderId: order.id,
        revisionId: revision.id,
        method: 'PHONE',
        recordedById: params.actorId,
        phoneNote: params.note,
        agreedTotal: grandTotal,
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'AGREED',
        agreedTotal: grandTotal,
        outstandingBalance: grandTotal,
        amountPaid: money(0),
        isPaid: D(grandTotal).eq(0),
        agreedAt: new Date(),
      },
    });
    await tx.delivery.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        status: 'PENDING',
        instructions: order.deliveryInstructions,
      },
      update: {},
    });
  });

  await writeAudit({
    businessId: params.businessId,
    actorId: params.actorId,
    entityType: 'Order',
    entityId: order.id,
    action: 'PHONE_AGREEMENT',
    details: { note: params.note, revisionId: revision.id },
  });

  await createNotification({
    businessId: params.businessId,
    recipientPhone: order.customer.phone,
    type: 'ORDER_FINALIZED',
    orderId: order.id,
    message: `OrderProof: Order ${order.orderNumber} approved by phone. Final total ${formatMsg(grandTotal)}.`,
    linkPath: `/pay/${order.id}`,
  });
  await createNotification({
    businessId: params.businessId,
    recipientPhone: order.customer.phone,
    type: 'PAYMENT_LINK',
    orderId: order.id,
    message: `OrderProof: Pay ${formatMsg(grandTotal)} for ${order.orderNumber}:`,
    linkPath: `/pay/${order.id}`,
  });

  return getOrder(params.businessId, order.id);
}

export async function markReadyForDelivery(
  businessId: string,
  actorId: string,
  orderId: string
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: { customer: true },
  });
  if (!order) throw notFound('Order not found');
  assertTransition(order.status, 'READY_FOR_DELIVERY');

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'READY_FOR_DELIVERY' },
    });
    await tx.delivery.upsert({
      where: { orderId },
      create: {
        orderId,
        status: 'READY',
        instructions: order.deliveryInstructions,
      },
      update: { status: 'READY' },
    });
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Order',
    entityId: orderId,
    action: 'READY_FOR_DELIVERY',
  });

  await createNotification({
    businessId,
    recipientPhone: order.customer.phone,
    type: 'ORDER_READY',
    orderId,
    message: `OrderProof: Order ${order.orderNumber} is ready for delivery.`,
    linkPath: `/customer/orders/${orderId}`,
  });

  return getOrder(businessId, orderId);
}

export async function dispatchOrder(
  businessId: string,
  actorId: string,
  orderId: string,
  data?: { courierName?: string; courierPhone?: string }
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: { customer: true, delivery: true },
  });
  if (!order) throw notFound('Order not found');
  assertTransition(order.status, 'DISPATCHED');

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'DISPATCHED' },
    });
    await tx.delivery.upsert({
      where: { orderId },
      create: {
        orderId,
        status: 'DISPATCHED',
        dispatchedAt: new Date(),
        courierName: data?.courierName,
        courierPhone: data?.courierPhone,
        instructions: order.deliveryInstructions,
      },
      update: {
        status: 'DISPATCHED',
        dispatchedAt: new Date(),
        courierName: data?.courierName,
        courierPhone: data?.courierPhone,
      },
    });
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Order',
    entityId: orderId,
    action: 'DISPATCH',
    details: data,
  });

  await createNotification({
    businessId,
    recipientPhone: order.customer.phone,
    type: 'ORDER_DISPATCHED',
    orderId,
    message: `OrderProof: Order ${order.orderNumber} is on the way.`,
    linkPath: `/customer/orders/${orderId}`,
  });

  return getOrder(businessId, orderId);
}

export async function deliverOrder(
  businessId: string,
  actorId: string,
  orderId: string,
  data?: { proofNote?: string }
) {
  let order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: { customer: true, requestItems: true },
  });
  if (!order) throw notFound('Order not found');

  // Completing an untouched request creates an invoice from the original
  // requested values. It auto-agrees only when the customer has kept the
  // default auto-approval preference on. Otherwise it is sent for approval.
  if (order.status === 'SUBMITTED') {
    const prepared = await savePreparation({
      businessId,
      actorId,
      orderId,
      sendForApproval: true,
      deliveryCharge: order.estimatedDeliveryCharge.toString(),
      preparationNote: 'Completed without changes to the customer request',
      items: order.requestItems.map((item) => ({
        requestItemId: item.id,
        productNameSnapshot: item.productNameSnapshot,
        variantNameSnapshot: item.variantNameSnapshot ?? undefined,
        brandSnapshot: item.brandSnapshot ?? undefined,
        unitSnapshot: item.unitSnapshot,
        pricingTypeSnapshot: item.pricingTypeSnapshot,
        catalogueUnitPrice: item.catalogueUnitPrice.toString(),
        confirmedUnitPrice: item.catalogueUnitPrice.toString(),
        requestedAmount: item.requestedAmount.toString(),
        estimatedQuantity: item.estimatedQuantity.toString(),
        actualQuantity: item.estimatedQuantity.toString(),
        note: item.note ?? undefined,
      })),
    });
    if (prepared.status !== 'AGREED') return prepared;
    order = await prisma.order.findFirst({
      where: { id: orderId, businessId },
      include: { customer: true, requestItems: true },
    });
    if (!order) throw notFound('Order not found');
  }
  assertTransition(order.status, 'DELIVERED');

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await tx.delivery.update({
      where: { orderId },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
        proofNote: data?.proofNote,
      },
    });
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Order',
    entityId: orderId,
    action: 'COMPLETE',
    details: data,
  });

  await createNotification({
    businessId,
    recipientPhone: order.customer.phone,
    type: 'ORDER_DELIVERED',
    orderId,
    message: `OrderProof: Order ${order.orderNumber} has been completed. Thank you!`,
    linkPath: `/customer/orders/${orderId}`,
  });

  return getOrder(businessId, orderId);
}

export async function cancelOrder(
  businessId: string,
  actorId: string,
  orderId: string,
  reason?: string
) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
  });
  if (!order) throw notFound('Order not found');
  if (!D(order.amountPaid).eq(0)) {
    throw badRequest('An order with recorded payments cannot be cancelled');
  }
  assertTransition(order.status, 'CANCELLED');

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelReason: reason,
    },
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Order',
    entityId: orderId,
    action: 'CANCEL',
    details: { reason },
  });

  return getOrder(businessId, orderId);
}

export async function sellerDashboard(businessId: string) {
  const statuses: OrderStatus[] = [
    'SUBMITTED',
    'PREPARING',
    'AWAITING_CUSTOMER_APPROVAL',
    'CHANGE_REQUESTED',
    'AGREED',
    'READY_FOR_DELIVERY',
    'DISPATCHED',
    'DELIVERED',
  ];

  const counts = await Promise.all(
    statuses.map(async (status) => ({
      status,
      count: await prisma.order.count({ where: { businessId, status } }),
    }))
  );

  const deliveredUnpaid = await prisma.order.count({
    where: { businessId, status: { in: ['DELIVERED', 'COMPLETED'] }, isPaid: false },
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const paymentsToday = await prisma.payment.aggregate({
    where: { businessId, paidAt: { gte: startOfDay } },
    _sum: { amount: true },
    _count: true,
  });
  const paymentsTodayTotal = money(paymentsToday._sum.amount || 0);
  const outstandingOrders = await prisma.order.aggregate({
    where: { businessId, outstandingBalance: { gt: 0 }, status: { notIn: ['CANCELLED', 'DRAFT'] } },
    _sum: { outstandingBalance: true },
  });
  const totalOutstanding = money(outstandingOrders._sum.outstandingBalance || 0);

  const attention = await prisma.order.findMany({
    where: {
      businessId,
      status: {
        in: ['SUBMITTED', 'AWAITING_CUSTOMER_APPROVAL', 'CHANGE_REQUESTED', 'READY_FOR_DELIVERY'],
      },
    },
    include: { customer: true },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c.count])),
    deliveredUnpaid,
    paymentsTodayTotal,
    paymentsTodayCount: paymentsToday._count,
    totalOutstanding,
    attention: attention.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      customerName: o.customer.name,
      estimatedTotal: money(o.estimatedTotal),
      agreedTotal: o.agreedTotal != null ? money(o.agreedTotal) : null,
      outstandingBalance: money(o.outstandingBalance),
      updatedAt: o.updatedAt,
    })),
  };
}

export async function customerDashboard(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
  });
  if (!customer) throw notFound('Customer not found');

  const where = { customerId, businessId };
  const include = { revisions: { orderBy: { revisionNumber: 'desc' as const }, take: 1 } };
  const [balance, needingApproval, active, recent] = await Promise.all([
    prisma.order.aggregate({ where, _sum: { outstandingBalance: true } }),
    prisma.order.findMany({ where: { ...where, status: 'AWAITING_CUSTOMER_APPROVAL' }, include, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.order.findMany({ where: { ...where, status: { in: ['SUBMITTED', 'PREPARING', 'AWAITING_CUSTOMER_APPROVAL', 'CHANGE_REQUESTED', 'AGREED', 'READY_FOR_DELIVERY', 'DISPATCHED'] } }, include, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.order.findMany({ where, include, orderBy: { createdAt: 'desc' }, take: 8 }),
  ]);
  const outstanding = money(balance._sum.outstandingBalance || 0);

  return {
    customer: { id: customer.id, name: customer.name, phone: customer.phone },
    outstandingBalance: outstanding,
    needingApproval: needingApproval.map(serializeOrder),
    activeOrders: active.map(serializeOrder),
    recentOrders: recent.map(serializeOrder),
  };
}

export function assertCustomerAccess(
  user: { role: string; customerId?: string; businessId: string },
  orderCustomerId: string,
  orderBusinessId: string
) {
  if (user.businessId !== orderBusinessId) throw forbidden('Cross-business access denied');
  if (user.role === 'CUSTOMER' && user.customerId !== orderCustomerId) {
    throw forbidden('Not your order');
  }
}
