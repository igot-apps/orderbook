import { Router } from 'express';
import * as notificationService from '../services/notificationService';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/me', requireRole('CUSTOMER'), async (req, res, next) => {
  try {
    res.json(
      await notificationService.listCustomerNotifications(
        req.user!.phone,
        req.user!.businessId
      )
    );
  } catch (e) {
    next(e);
  }
});

export default router;
