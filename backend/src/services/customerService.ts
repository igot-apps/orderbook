import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { badRequest, notFound, conflict } from '../lib/errors';
import { money, D } from '../lib/money';
import { writeAudit } from './auditService';

export async function listCustomers(businessId: string) {
  const customers = await prisma.customer.findMany({
    where: { businessId },
    include: {
      orders: {
        select: {
          id: true,
          outstandingBalance: true,
          status: true,
          createdAt: true,
          agreedAt: true,
        },
      },
      user: { select: { isActive: true } },
    },
    orderBy: { name: 'asc' },
  });

  return customers.map((c) => {
    const outstanding = c.orders.reduce(
      (sum, o) => sum.plus(D(o.outstandingBalance)),
      D(0)
    );
    const recent = [...c.orders].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )[0];
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      creditAllowed: c.creditAllowed,
      notes: c.notes,
      orderCount: c.orders.length,
      outstandingBalance: money(outstanding),
      isActive: c.user.isActive,
      recentActivity: recent?.createdAt ?? c.updatedAt,
      createdAt: c.createdAt,
    };
  });
}

export async function getCustomer(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    include: {
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 },
          delivery: true,
        },
      },
      user: true,
    },
  });
  if (!customer) throw notFound('Customer not found');

  const outstanding = customer.orders.reduce(
    (sum, o) => sum.plus(D(o.outstandingBalance)),
    D(0)
  );

  return {
    ...customer,
    outstandingBalance: money(outstanding),
    orders: customer.orders.map((o) => ({
      ...o,
      outstandingBalance: money(o.outstandingBalance),
      agreedTotal: o.agreedTotal ? money(o.agreedTotal) : null,
      amountPaid: money(o.amountPaid),
      estimatedTotal: money(o.estimatedTotal),
    })),
  };
}

export async function createCustomer(
  businessId: string,
  actorId: string,
  data: {
    name: string;
    phone: string;
    creditAllowed?: boolean;
    notes?: string;
    password?: string;
  }
) {
  const phone = data.phone.replace(/\s+/g, '').trim();
  if (!phone) throw badRequest('Phone is required');

  const existing = await prisma.user.findFirst({
    where: { businessId, phone },
  });
  if (existing) throw conflict('A user with this phone already exists');

  const passwordHash = await bcrypt.hash(data.password || '123456789', 10);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        businessId,
        name: data.name,
        phone,
        passwordHash,
        role: 'CUSTOMER',
      },
    });
    const customer = await tx.customer.create({
      data: {
        businessId,
        userId: user.id,
        name: data.name,
        phone,
        creditAllowed: data.creditAllowed ?? true,
        notes: data.notes,
      },
    });
    return { user, customer };
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Customer',
    entityId: result.customer.id,
    action: 'CREATE',
    details: { name: data.name, phone },
  });

  return result.customer;
}

export async function updateCustomer(
  businessId: string,
  actorId: string,
  customerId: string,
  data: {
    name?: string;
    creditAllowed?: boolean;
    notes?: string | null;
    isActive?: boolean;
  }
) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
  });
  if (!customer) throw notFound('Customer not found');

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.customer.update({
      where: { id: customerId },
      data: {
        name: data.name,
        creditAllowed: data.creditAllowed,
        notes: data.notes === undefined ? undefined : data.notes,
      },
    });
    if (data.name || data.isActive !== undefined) {
      await tx.user.update({
        where: { id: customer.userId },
        data: {
          name: data.name,
          isActive: data.isActive,
        },
      });
    }
    return c;
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Customer',
    entityId: customerId,
    action: 'UPDATE',
    details: data,
  });

  return updated;
}

export async function outstandingAging(businessId: string) {
  const orders = await prisma.order.findMany({
    where: {
      businessId,
      outstandingBalance: { gt: 0 },
      status: { in: ['AGREED', 'READY_FOR_DELIVERY', 'DISPATCHED', 'DELIVERED', 'COMPLETED'] },
    },
    include: { customer: true },
  });

  const now = Date.now();
  const buckets = {
    '0-7': [] as typeof enriched,
    '8-14': [] as typeof enriched,
    '15-30': [] as typeof enriched,
    '30+': [] as typeof enriched,
  };

  const enriched = orders.map((o) => {
    const anchor = o.agreedAt ?? o.createdAt;
    const days = Math.floor((now - anchor.getTime()) / (1000 * 60 * 60 * 24));
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customerId,
      customerName: o.customer.name,
      customerPhone: o.customer.phone,
      outstandingBalance: money(o.outstandingBalance),
      agreedTotal: o.agreedTotal ? money(o.agreedTotal) : null,
      amountPaid: money(o.amountPaid),
      status: o.status,
      daysOutstanding: days,
      agreedAt: o.agreedAt,
    };
  });

  for (const row of enriched) {
    if (row.daysOutstanding <= 7) buckets['0-7'].push(row);
    else if (row.daysOutstanding <= 14) buckets['8-14'].push(row);
    else if (row.daysOutstanding <= 30) buckets['15-30'].push(row);
    else buckets['30+'].push(row);
  }

  const sum = (rows: typeof enriched) =>
    money(rows.reduce((s, r) => s.plus(D(r.outstandingBalance)), D(0)));

  return {
    buckets: {
      '0-7': { items: buckets['0-7'], total: sum(buckets['0-7']) },
      '8-14': { items: buckets['8-14'], total: sum(buckets['8-14']) },
      '15-30': { items: buckets['15-30'], total: sum(buckets['15-30']) },
      '30+': { items: buckets['30+'], total: sum(buckets['30+']) },
    },
    grandTotal: sum(enriched),
  };
}
export async function getPreferences(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: { autoApproveUnchanged: true },
  });
  if (!customer) throw notFound('Customer not found');
  return customer;
}

export async function updatePreferences(
  businessId: string,
  customerId: string,
  autoApproveUnchanged: boolean
) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) throw notFound('Customer not found');
  return prisma.customer.update({
    where: { id: customerId },
    data: { autoApproveUnchanged },
    select: { autoApproveUnchanged: true },
  });
}

