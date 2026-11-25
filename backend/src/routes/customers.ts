import { Router } from 'express';
import { z } from 'zod';
import * as customerService from '../services/customerService';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
router.use(requireAuth);

router.get('/me/preferences', requireRole('CUSTOMER'), async (req, res, next) => {
  try {
    res.json(await customerService.getPreferences(req.user!.businessId, req.user!.customerId!));
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/me/preferences',
  requireRole('CUSTOMER'),
  validate({ body: z.object({ autoApproveUnchanged: z.boolean() }) }),
  async (req, res, next) => {
    try {
      res.json(await customerService.updatePreferences(
        req.user!.businessId,
        req.user!.customerId!,
        req.body.autoApproveUnchanged
      ));
    } catch (e) {
      next(e);
    }
  }
);

router.use(requireRole('SELLER'));

router.get('/', async (req, res, next) => {
  try {
    res.json(await customerService.listCustomers(req.user!.businessId));
  } catch (e) {
    next(e);
  }
});

router.get('/outstanding/aging', async (req, res, next) => {
  try {
    res.json(await customerService.outstandingAging(req.user!.businessId));
  } catch (e) {
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    res.json(await customerService.getCustomer(req.user!.businessId, req.params.id));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validate({
    body: z.object({
      name: z.string().min(1),
      phone: z.string().min(9),
      creditAllowed: z.boolean().optional(),
      notes: z.string().optional(),
      password: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const customer = await customerService.createCustomer(
        req.user!.businessId,
        req.user!.id,
        req.body
      );
      res.status(201).json(customer);
    } catch (e) {
      next(e);
    }
  }
);

router.patch('/:id', async (req, res, next) => {
  try {
    res.json(
      await customerService.updateCustomer(
        req.user!.businessId,
        req.user!.id,
        req.params.id,
        req.body
      )
    );
  } catch (e) {
    next(e);
  }
});

export default router;
