import { Router } from 'express';
import { z } from 'zod';
import { OrderStatus, PricingType, SellingUnit } from '@prisma/client';
import * as orderService from '../services/orderService';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { forbidden } from '../lib/errors';

const router = Router();
router.use(requireAuth);

router.get('/dashboard/seller', requireRole('SELLER'), async (req, res, next) => {
  try {
    res.json(await orderService.sellerDashboard(req.user!.businessId));
  } catch (e) {
    next(e);
  }
});

router.get('/dashboard/customer', requireRole('CUSTOMER'), async (req, res, next) => {
  try {
    res.json(
      await orderService.customerDashboard(req.user!.businessId, req.user!.customerId!)
    );
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const statusParam = req.query.status as string | undefined;
    let status: OrderStatus | OrderStatus[] | undefined;
    if (statusParam) {
      status = statusParam.includes(',')
        ? (statusParam.split(',') as OrderStatus[])
        : (statusParam as OrderStatus);
    }

    const customerId =
      req.user!.role === 'CUSTOMER'
        ? req.user!.customerId
        : (req.query.customerId as string | undefined);

    const paging = req.query.page !== undefined
      ? z.object({ page: z.coerce.number().int().min(1).max(100000), pageSize: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query)
      : undefined;
    const orders = await orderService.listOrders({
        businessId: req.user!.businessId,
        customerId,
        status,
        q: req.query.q as string | undefined,
        ...paging,
      });
    res.json(paging ? { items: orders.slice(0, paging.pageSize), hasMore: orders.length > paging.pageSize, page: paging.page } : orders);
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await orderService.getOrder(
      req.user!.businessId,
      req.params.id,
      req.user!.role === 'CUSTOMER' ? { customerId: req.user!.customerId } : undefined
    );
    res.json(order);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validate({
    body: z.object({
      customerId: z.string().optional(),
      items: z
        .array(
          z.object({
            productId: z.string().optional(),
            variantId: z.string().optional(),
            isCustom: z.boolean().optional(),
            customName: z.string().optional(),
            customUnit: z.nativeEnum(SellingUnit).optional(),
            requestedAmount: z.union([z.string(), z.number()]),
            note: z.string().optional(),
          })
        )
        .min(1),
      deliveryInstructions: z.string().optional(),
      estimatedDeliveryCharge: z.union([z.string(), z.number()]).optional(),
      submit: z.boolean().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      let customerId = req.body.customerId as string | undefined;
      if (req.user!.role === 'CUSTOMER') {
        customerId = req.user!.customerId;
      } else if (!customerId) {
        throw forbidden('customerId required');
      }

      const order = await orderService.createAndSubmitOrder({
        businessId: req.user!.businessId,
        customerId: customerId!,
        actorId: req.user!.id,
        items: req.body.items,
        deliveryInstructions: req.body.deliveryInstructions,
        estimatedDeliveryCharge: req.body.estimatedDeliveryCharge,
        submit: req.body.submit,
      });
      res.status(201).json(order);
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/:id/prepare',
  requireRole('SELLER'),
  validate({
    body: z.object({
      items: z.array(
        z.object({
          requestItemId: z.string().optional(),
          productNameSnapshot: z.string(),
          variantNameSnapshot: z.string().optional(),
          brandSnapshot: z.string().optional().nullable(),
          unitSnapshot: z.nativeEnum(SellingUnit),
          pricingTypeSnapshot: z.nativeEnum(PricingType),
          catalogueUnitPrice: z.union([z.string(), z.number()]),
          confirmedUnitPrice: z.union([z.string(), z.number()]),
          priceChangeReason: z.string().optional(),
          requestedAmount: z.union([z.string(), z.number()]),
          estimatedQuantity: z.union([z.string(), z.number()]),
          actualQuantity: z.union([z.string(), z.number()]),
          isRemoved: z.boolean().optional(),
          isReplacement: z.boolean().optional(),
          note: z.string().optional(),
        })
      ),
      deliveryCharge: z.union([z.string(), z.number()]).optional(),
      preparationNote: z.string().optional(),
      sendForApproval: z.boolean().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(
        await orderService.savePreparation({
          businessId: req.user!.businessId,
          actorId: req.user!.id,
          orderId: req.params.id,
          ...req.body,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/:id/respond',
  requireRole('CUSTOMER'),
  validate({
    body: z.object({
      action: z.enum(['ACCEPT', 'REQUEST_CHANGE']),
      message: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(
        await orderService.customerRespond({
          businessId: req.user!.businessId,
          customerId: req.user!.customerId!,
          actorId: req.user!.id,
          orderId: req.params.id,
          action: req.body.action,
          message: req.body.message,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/:id/agree-phone',
  requireRole('SELLER'),
  validate({
    body: z.object({
      note: z.string().min(1),
      revisionId: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(
        await orderService.recordPhoneAgreement({
          businessId: req.user!.businessId,
          actorId: req.user!.id,
          orderId: req.params.id,
          note: req.body.note,
          revisionId: req.body.revisionId,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/:id/flag-price',
  requireRole('CUSTOMER'),
  validate({ body: z.object({ message: z.string().min(1) }) }),
  async (req, res, next) => {
    try {
      res.json(
        await orderService.flagAgreedPrice({
          businessId: req.user!.businessId,
          customerId: req.user!.customerId!,
          actorId: req.user!.id,
          orderId: req.params.id,
          message: req.body.message,
        })
      );
    } catch (e) {
      next(e);
    }
  }
);

router.post('/:id/ready', requireRole('SELLER'), async (req, res, next) => {
  try {
    res.json(
      await orderService.markReadyForDelivery(req.user!.businessId, req.user!.id, req.params.id)
    );
  } catch (e) {
    next(e);
  }
});

router.post(
  '/:id/dispatch',
  requireRole('SELLER'),
  async (req, res, next) => {
    try {
      res.json(
        await orderService.dispatchOrder(req.user!.businessId, req.user!.id, req.params.id, req.body)
      );
    } catch (e) {
      next(e);
    }
  }
);

router.post('/:id/deliver', requireRole('SELLER'), async (req, res, next) => {
  try {
    res.json(
      await orderService.deliverOrder(req.user!.businessId, req.user!.id, req.params.id, req.body)
    );
  } catch (e) {
    next(e);
  }
});

router.post('/:id/cancel', requireRole('SELLER'), async (req, res, next) => {
  try {
    res.json(
      await orderService.cancelOrder(
        req.user!.businessId,
        req.user!.id,
        req.params.id,
        req.body?.reason
      )
    );
  } catch (e) {
    next(e);
  }
});

export default router;
