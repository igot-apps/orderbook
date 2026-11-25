import { Router } from 'express';
import { z } from 'zod';
import { PaymentNetwork } from '@prisma/client';
import * as paymentService from '../services/paymentService';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { forbidden } from '../lib/errors';

const router = Router();

// Payment details are scoped to the signed-in business and customer.
router.get('/order/:orderId', requireAuth, async (req, res, next) => {
  try {
    const page = await paymentService.getPaymentPage(req.params.orderId);
    if (req.user!.businessId !== page.businessId ||
        (req.user!.role === 'CUSTOMER' && req.user!.customerId !== page.customerId)) {
      throw forbidden('This order belongs to another account');
    }
    res.json(page);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/initiate',
  requireAuth,
  validate({
    body: z.object({
      orderId: z.string(),
      amount: z.union([z.string(), z.number()]),
      network: z.nativeEnum(PaymentNetwork),
      momoPhone: z.string().min(9),
    }),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json(
        await paymentService.initiatePayment({
          ...req.body,
          businessId: req.user!.businessId,
          actorId: req.user!.id,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);

// MVP checkout: simulate provider success on the server after creating the attempt.
router.post('/checkout', requireAuth, requireRole('CUSTOMER'), validate({
  body: z.object({
    orderId: z.string(),
    amount: z.union([z.string(), z.number()]),
    network: z.nativeEnum(PaymentNetwork),
    momoPhone: z.string().min(9),
  }),
}), async (req, res, next) => {
  try {
    const order = await paymentService.getPaymentPage(req.body.orderId);
    if (order.businessId !== req.user!.businessId || order.customerId !== req.user!.customerId) {
      res.status(403).json({ error: 'This order belongs to another customer' });
      return;
    }
    const attempt = await paymentService.initiatePayment({
      ...req.body,
      businessId: req.user!.businessId,
      actorId: req.user!.id,
    });
    const payment = await paymentService.processWebhook({
      internalReference: attempt.internalReference,
      status: 'SUCCESS',
      providerReference: `SIM-${attempt.internalReference}`,
    });
    res.status(201).json(payment);
  } catch (e) { next(e); }
});

// Simulated provider webhook — no user JWT; uses internal reference
router.post(
  '/webhook',
  validate({
    body: z.object({
      internalReference: z.string(),
      status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
      providerReference: z.string().optional(),
      failureReason: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      if (process.env.NODE_ENV === 'production' &&
          (!process.env.PAYMENT_WEBHOOK_SECRET || req.header('x-payment-webhook-secret') !== process.env.PAYMENT_WEBHOOK_SECRET)) {
        throw forbidden('Payment callback is not authorized');
      }
      const result = await paymentService.processWebhook(req.body);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

router.get('/', requireAuth, requireRole('SELLER'), async (req, res, next) => {
  try {
    res.json(await paymentService.listPayments(req.user!.businessId));
  } catch (e) {
    next(e);
  }
});

router.get('/attempts', requireAuth, requireRole('SELLER'), async (req, res, next) => {
  try {
    res.json(
      await paymentService.listAttempts(
        req.user!.businessId,
        req.query.status as string | undefined
      )
    );
  } catch (e) {
    next(e);
  }
});

router.get('/receipts/:id', requireAuth, async (req, res, next) => {
  try {
    res.json(await paymentService.getReceipt(req.params.id, req.user!.businessId));
  } catch (e) {
    next(e);
  }
});

router.get('/history/me', requireAuth, requireRole('CUSTOMER'), async (req, res, next) => {
  try {
    res.json(
      await paymentService.customerPaymentHistory(
        req.user!.businessId,
        req.user!.customerId!
      )
    );
  } catch (e) {
    next(e);
  }
});

export default router;
