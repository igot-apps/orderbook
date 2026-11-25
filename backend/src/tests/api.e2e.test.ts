import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';

const app = createApp();

async function login(phone: string) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ phone, password: '123456789' });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe('OrderBook API e2e', () => {
  let businessId: string;
  let salmonVariantId: string;
  let amaCustomerId: string;
  let otherBusinessId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.includes('orderproof_test')) {
      throw new Error('API end-to-end tests require the isolated orderproof_test database');
    }
    // Ensure base seed-like data exists (idempotent-ish for test DB)
    const existing = await prisma.user.findFirst({ where: { phone: '0240000000' } });
    if (!existing) {
      const hash = await bcrypt.hash('123456789', 10);
      const business = await prisma.business.create({
        data: {
          name: 'OrderBook Store',
          phone: '0240000000',
          settings: {
            create: {
              approvalToleranceAbs: '2.00',
              approvalTolerancePct: '5.00',
              defaultDeliveryCharge: '0.00',
            },
          },
        },
      });
      businessId = business.id;
      await prisma.user.create({
        data: {
          businessId,
          name: 'OrderBook Store',
          phone: '0240000000',
          passwordHash: hash,
          role: 'SELLER',
        },
      });
      const amaUser = await prisma.user.create({
        data: {
          businessId,
          name: 'Ama Mensah',
          phone: '0241111111',
          passwordHash: hash,
          role: 'CUSTOMER',
        },
      });
      const ama = await prisma.customer.create({
        data: {
          businessId,
          userId: amaUser.id,
          name: 'Ama Mensah',
          phone: '0241111111',
          creditAllowed: true,
        },
      });
      amaCustomerId = ama.id;
      const product = await prisma.product.create({
        data: {
          businessId,
          name: 'Salmon',
          category: 'Fish',
          isVisible: true,
          variants: {
            create: {
              name: 'Standard',
              unit: 'KILOGRAM',
              pricingType: 'PER_MEASUREMENT',
              unitPrice: '40.00',
            },
          },
        },
        include: { variants: true },
      });
      salmonVariantId = product.variants[0].id;
    } else {
      businessId = existing.businessId;
      const ama = await prisma.customer.findFirst({ where: { phone: '0241111111' } });
      amaCustomerId = ama!.id;
      const variant = await prisma.productVariant.findFirst({
        where: { product: { businessId, name: 'Salmon' } },
      });
      salmonVariantId = variant!.id;
      const settings = await prisma.businessSettings.findUnique({ where: { businessId } });
      if (!settings) {
        await prisma.businessSettings.create({
          data: {
            businessId,
            approvalToleranceAbs: '2.00',
            approvalTolerancePct: '5.00',
          },
        });
      }
    }

    // second business for isolation test
    let other = await prisma.business.findFirst({ where: { name: 'Other Biz Test' } });
    if (!other) {
      const hash = await bcrypt.hash('123456789', 10);
      other = await prisma.business.create({
        data: {
          name: 'Other Biz Test',
          settings: { create: {} },
          users: {
            create: {
              name: 'Other Seller',
              phone: '0259999999',
              passwordHash: hash,
              role: 'SELLER',
            },
          },
        },
      });
    }
    otherBusinessId = other.id;
  });

  it('logs in seller and customer with role authorization', async () => {
    const sellerToken = await login('0240000000');
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(me.body.role).toBe('SELLER');

    const customerToken = await login('0241111111');
    const denied = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(denied.status).toBe(403);
  });

  it('runs full salmon scenario with approval, payment idempotency, and delivery', async () => {
    const customerToken = await login('0241111111');
    const sellerToken = await login('0240000000');

    // create order money-first
    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [
          {
            variantId: salmonVariantId,
            requestedAmount: '40',
            note: 'Not too fatty',
          },
        ],
        deliveryInstructions: 'Gate 2',
        estimatedDeliveryCharge: '0',
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('SUBMITTED');
    expect(created.body.requestItems[0].estimatedQuantity).toBe('1.0000');
    expect(created.body.estimatedTotal).toBe('40.00');
    const orderId = created.body.id as string;

    // The same submitted request must immediately be visible to both roles.
    const customerOrders = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`);
    const sellerRequests = await request(app)
      .get('/api/orders?status=SUBMITTED')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(customerOrders.status).toBe(200);
    expect(sellerRequests.status).toBe(200);
    expect(customerOrders.body.some((o: any) => o.id === orderId)).toBe(true);
    expect(sellerRequests.body.some((o: any) => o.id === orderId)).toBe(true);

    // prepare with 1.15 kg => 46
    const prep = await request(app)
      .post(`/api/orders/${orderId}/prepare`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        sendForApproval: true,
        deliveryCharge: '0',
        items: [
          {
            requestItemId: created.body.requestItems[0].id,
            productNameSnapshot: 'Salmon',
            variantNameSnapshot: 'Standard',
            unitSnapshot: 'KILOGRAM',
            pricingTypeSnapshot: 'PER_MEASUREMENT',
            catalogueUnitPrice: '40.00',
            confirmedUnitPrice: '40.00',
            requestedAmount: '40.00',
            estimatedQuantity: '1',
            actualQuantity: '1.15',
            priceChangeReason: 'Available salmon piece weighs 1.15 kg',
          },
        ],
      });
    expect(prep.status).toBe(200);
    expect(prep.body.status).toBe('AWAITING_CUSTOMER_APPROVAL');
    const rev = prep.body.revisions[prep.body.revisions.length - 1];
    expect(rev.grandTotal).toBe('46.00');
    expect(rev.items[0].actualLineTotal).toBe('46.00');

    const notifications = await request(app)
      .get('/api/notifications/me')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(notifications.status).toBe(200);
    expect(notifications.body.some((n: any) => n.orderId === orderId && n.type === 'AWAITING_APPROVAL')).toBe(true);
    const removedSmsInbox = await request(app)
      .get('/api/notifications/inbox')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(removedSmsInbox.status).toBe(404);

    // revision immutability: locked after accept
    const accept = await request(app)
      .post(`/api/orders/${orderId}/respond`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ action: 'ACCEPT' });
    expect(accept.status).toBe(200);
    expect(accept.body.status).toBe('AGREED');
    expect(accept.body.agreedTotal).toBe('46.00');
    expect(accept.body.outstandingBalance).toBe('46.00');
    const lockedRev = accept.body.revisions.find((r: any) => r.isLocked);
    expect(lockedRev).toBeTruthy();

    // partial payment
    const init1 = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderId,
        amount: '20.00',
        network: 'MTN',
        momoPhone: '0241111111',
      });
    expect(init1.status).toBe(201);
    const attemptId = init1.body.attemptId;
    const internalReference = init1.body.internalReference;

    const fail = await request(app)
      .post('/api/payments/webhook')
      .send({ internalReference, status: 'FAILED', failureReason: 'Insufficient funds' });
    expect(fail.status).toBe(200);

    let order = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(order.body.outstandingBalance).toBe('46.00');
    expect(order.body.amountPaid).toBe('0.00');

    // new successful partial
    const init2 = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderId,
        amount: '20.00',
        network: 'MTN',
        momoPhone: '0241111111',
      });
    const ref2 = init2.body.internalReference;
    const providerRef = `MOMO-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const ok1 = await request(app).post('/api/payments/webhook').send({
      internalReference: ref2,
      status: 'SUCCESS',
      providerReference: providerRef,
    });
    expect(ok1.status).toBe(200);
    expect(ok1.body.idempotent).toBe(false);

    const ok2 = await request(app).post('/api/payments/webhook').send({
      internalReference: ref2,
      status: 'SUCCESS',
      providerReference: providerRef,
    });
    expect(ok2.status).toBe(200);
    expect(ok2.body.idempotent).toBe(true);

    order = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(order.body.amountPaid).toBe('20.00');
    expect(order.body.outstandingBalance).toBe('26.00');
    expect(order.body.payments.length).toBe(1);

    // pay remaining
    const init3 = await request(app)
      .post('/api/payments/initiate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        orderId,
        amount: '26.00',
        network: 'TELECEL',
        momoPhone: '0241111111',
      });
    await request(app).post('/api/payments/webhook').send({
      internalReference: init3.body.internalReference,
      status: 'SUCCESS',
    });

    order = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(order.body.isPaid).toBe(true);
    expect(order.body.outstandingBalance).toBe('0.00');

    // simplified delivery flow
    const delivered = await request(app)
      .post(`/api/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ proofNote: 'Marked as delivered by seller' });
    expect(delivered.body.status).toBe('COMPLETED');
    expect(delivered.body.timeline.length).toBeGreaterThan(5);

    // cross-business prevention
    const otherSeller = await login('0259999999');
    const cross = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${otherSeller}`);
    expect(cross.status).toBe(404);

    void attemptId;
    void otherBusinessId;
  });

  it('completes an unchanged request directly and respects the customer auto-approval switch', async () => {
    const customerToken = await login('0241111111');
    const sellerToken = await login('0240000000');

    const preferences = await request(app)
      .get('/api/customers/me/preferences')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(preferences.body.autoApproveUnchanged).toBe(true);

    const createOrder = async () => request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ variantId: salmonVariantId, requestedAmount: '40' }] });

    const unchanged = await createOrder();
    const completed = await request(app)
      .post(`/api/orders/${unchanged.body.id}/deliver`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ proofNote: 'Completed without invoice changes' });
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.agreedTotal).toBe('40.00');

    await request(app)
      .patch('/api/customers/me/preferences')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ autoApproveUnchanged: false });

    const approvalRequired = await createOrder();
    const sentForApproval = await request(app)
      .post(`/api/orders/${approvalRequired.body.id}/deliver`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ proofNote: 'Attempted direct completion' });
    expect(sentForApproval.status).toBe(200);
    expect(sentForApproval.body.status).toBe('AWAITING_CUSTOMER_APPROVAL');

    await request(app)
      .patch('/api/customers/me/preferences')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ autoApproveUnchanged: true });
  });

  it('records a customer checkout immediately and shows the receipt to the shop', async () => {
    const customerToken = await login('0241111111');
    const sellerToken = await login('0240000000');
    const created = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ variantId: salmonVariantId, requestedAmount: '40' }] });
    const orderId = created.body.id;
    const completed = await request(app).post(`/api/orders/${orderId}/deliver`)
      .set('Authorization', `Bearer ${sellerToken}`).send({});
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.outstandingBalance).toBe('40.00');

    const checkout = await request(app).post('/api/payments/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId, amount: '40', network: 'MTN', momoPhone: '0241111111' });
    expect(checkout.status).toBe(201);
    expect(checkout.body.status).toBe('SUCCESS');
    expect(checkout.body.receiptNumber).toMatch(/^RCPT-/);

    const customerOrder = await request(app).get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(customerOrder.body.isPaid).toBe(true);
    expect(customerOrder.body.outstandingBalance).toBe('0.00');
    const sellerPayments = await request(app).get('/api/payments')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(sellerPayments.body.some((p: any) => p.receiptNumber === checkout.body.receiptNumber)).toBe(true);
  });

  it('requires approval for a changed item even when its total stays the same', async () => {
    const customerToken = await login('0241111111');
    const sellerToken = await login('0240000000');
    const created = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ variantId: salmonVariantId, requestedAmount: '40' }] });
    const original = created.body.requestItems[0];
    const revised = await request(app).post(`/api/orders/${created.body.id}/prepare`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ sendForApproval: true, items: [{
        requestItemId: original.id,
        productNameSnapshot: original.productNameSnapshot,
        variantNameSnapshot: original.variantNameSnapshot,
        unitSnapshot: original.unitSnapshot,
        pricingTypeSnapshot: original.pricingTypeSnapshot,
        catalogueUnitPrice: '40',
        confirmedUnitPrice: '32',
        requestedAmount: '40',
        estimatedQuantity: '1',
        actualQuantity: '1.25',
        priceChangeReason: 'Different weight and negotiated unit price',
      }] });
    expect(revised.status).toBe(200);
    expect(revised.body.status).toBe('AWAITING_CUSTOMER_APPROVAL');
    expect(revised.body.revisions.at(-1).grandTotal).toBe('40.00');

    const prematurePay = await request(app).post('/api/payments/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: created.body.id, amount: '40', network: 'MTN', momoPhone: '0241111111' });
    expect(prematurePay.status).toBe(400);
  });

  it('lets the seller revise an unpaid agreed invoice and pauses payment until reapproval', async () => {
    const customerToken = await login('0241111111');
    const sellerToken = await login('0240000000');
    const created = await request(app).post('/api/orders')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ items: [{ variantId: salmonVariantId, requestedAmount: '40' }] });
    expect(created.status).toBe(201);
    const item = created.body.requestItems[0];
    const originalLine = {
      requestItemId: item.id,
      productNameSnapshot: item.productNameSnapshot,
      variantNameSnapshot: item.variantNameSnapshot,
      unitSnapshot: item.unitSnapshot,
      pricingTypeSnapshot: item.pricingTypeSnapshot,
      catalogueUnitPrice: '40',
      confirmedUnitPrice: '40',
      requestedAmount: '40',
      estimatedQuantity: '1',
      actualQuantity: '1',
    };
    const confirmed = await request(app).post(`/api/orders/${created.body.id}/prepare`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ sendForApproval: true, items: [originalLine] });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('AGREED');
    expect(confirmed.body.agreedTotal).toBe('40.00');

    const revised = await request(app).post(`/api/orders/${created.body.id}/prepare`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ sendForApproval: true, items: [{
        ...originalLine,
        actualQuantity: '1.2',
        priceChangeReason: 'The available fish weighs 1.2 kg',
      }] });
    expect(revised.status).toBe(200);
    expect(revised.body.status).toBe('AWAITING_CUSTOMER_APPROVAL');
    expect(revised.body.agreedTotal).toBeNull();
    expect(revised.body.revisions.at(-1).grandTotal).toBe('48.00');
    expect(revised.body.agreements).toHaveLength(1);

    const prematurePay = await request(app).post('/api/payments/checkout')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ orderId: created.body.id, amount: '40', network: 'MTN', momoPhone: '0241111111' });
    expect(prematurePay.status).toBe(400);
  });
});
