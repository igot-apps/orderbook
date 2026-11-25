import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  order: { findMany: vi.fn(), aggregate: vi.fn() },
  customer: { findFirst: vi.fn() },
}));
vi.mock('../lib/prisma', () => ({ prisma: db }));
import { customerDashboard, listOrders } from '../services/orderService';

describe('Large order histories', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bounds paginated queries and preserves customer isolation and status filters', async () => {
    db.order.findMany.mockResolvedValue([]);
    await listOrders({ businessId: 'store', customerId: 'customer', status: 'AGREED', page: 3, pageSize: 25 });
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 'store', customerId: 'customer', status: 'AGREED' },
      skip: 50, take: 26, include: { customer: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('aggregates the full balance while limiting dashboard order payloads', async () => {
    db.customer.findFirst.mockResolvedValue({ id: 'customer', name: 'Ama', phone: '024' });
    db.order.findMany.mockResolvedValue([]);
    db.order.aggregate.mockResolvedValue({ _sum: { outstandingBalance: '123456.78' } });
    const result = await customerDashboard('store', 'customer');
    expect(result.outstandingBalance).toBe('123456.78');
    expect(db.order.findMany).toHaveBeenCalledTimes(3);
    for (const [query] of db.order.findMany.mock.calls) {
      expect(query.where).toMatchObject({ businessId: 'store', customerId: 'customer' });
      expect(query.take).toBeLessThanOrEqual(20);
    }
  });
});
