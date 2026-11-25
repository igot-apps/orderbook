import { Router } from 'express';
import { z } from 'zod';
import * as authService from '../services/authService';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

router.post(
  '/login',
  validate({
    body: z.object({
      phone: z.string().min(9),
      password: z.string().min(1),
    }),
  }),
  async (req, res, next) => {
    try {
      const result = await authService.login(req.body.phone, req.body.password);
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
);

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const me = await authService.getMe(req.user!.id);
    res.json(me);
  } catch (e) {
    next(e);
  }
});

export default router;
