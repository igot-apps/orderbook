import { Router } from 'express';
import { z } from 'zod';
import { PricingType, SellingUnit } from '@prisma/client';
import * as productService from '../services/productService';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
router.use(requireAuth);

const unitEnum = z.nativeEnum(SellingUnit);
const pricingEnum = z.nativeEnum(PricingType);

router.get('/', async (req, res, next) => {
  try {
    const products = await productService.listProducts({
      businessId: req.user!.businessId,
      q: req.query.q as string | undefined,
      category: req.query.category as string | undefined,
      visibleOnly: req.user!.role === 'CUSTOMER' ? true : req.query.visibleOnly === 'true',
      includeArchived: req.user!.role === 'SELLER' && req.query.includeArchived === 'true',
      customerId: req.user!.customerId,
    });
    res.json(products);
  } catch (e) {
    next(e);
  }
});

router.get('/meta/categories', async (req, res, next) => {
  try {
    res.json(await productService.getCategories(req.user!.businessId));
  } catch (e) {
    next(e);
  }
});

router.get('/meta/highlights', async (req, res, next) => {
  try {
    res.json(
      await productService.recentAndMostUsed(req.user!.businessId, req.user!.customerId)
    );
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  requireRole('SELLER'),
  validate({
    body: z.object({
      name: z.string().min(1),
      category: z.string().min(1),
      description: z.string().optional(),
      imageUrl: z.string().optional(),
      isVisible: z.boolean().optional(),
      variants: z
        .array(
          z.object({
            name: z.string().min(1),
            brand: z.string().optional(),
            unit: unitEnum,
            pricingType: pricingEnum,
            unitPrice: z.union([z.string(), z.number()]),
          })
        )
        .min(1),
    }),
  }),
  async (req, res, next) => {
    try {
      const product = await productService.createProduct(
        req.user!.businessId,
        req.user!.id,
        req.body
      );
      res.status(201).json(product);
    } catch (e) {
      next(e);
    }
  }
);

router.patch(
  '/:id',
  requireRole('SELLER'),
  async (req, res, next) => {
    try {
      const product = await productService.updateProduct(
        req.user!.businessId,
        req.user!.id,
        req.params.id,
        req.body
      );
      res.json(product);
    } catch (e) {
      next(e);
    }
  }
);

router.post('/:id/archive', requireRole('SELLER'), async (req, res, next) => {
  try {
    res.json(
      await productService.archiveProduct(req.user!.businessId, req.user!.id, req.params.id)
    );
  } catch (e) {
    next(e);
  }
});

router.post(
  '/:id/variants',
  requireRole('SELLER'),
  validate({
    body: z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      brand: z.string().optional(),
      unit: unitEnum,
      pricingType: pricingEnum,
      unitPrice: z.union([z.string(), z.number()]),
      isActive: z.boolean().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json(
        await productService.upsertVariant(
          req.user!.businessId,
          req.user!.id,
          req.params.id,
          req.body
        )
      );
    } catch (e) {
      next(e);
    }
  }
);

router.post('/:id/favourite', requireRole('CUSTOMER'), async (req, res, next) => {
  try {
    if (!req.user!.customerId) throw new Error('No customer profile');
    res.json(await productService.toggleFavourite(req.user!.customerId, req.params.id));
  } catch (e) {
    next(e);
  }
});

export default router;
