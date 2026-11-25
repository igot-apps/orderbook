import { Router } from 'express';
import * as reportService from '../services/reportService';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
router.use(requireAuth, requireRole('SELLER'));

router.get('/', async (req, res, next) => {
  try {
    res.json(await reportService.basicReports(req.user!.businessId));
  } catch (e) {
    next(e);
  }
});

router.get('/settings', async (req, res, next) => {
  try {
    res.json(await reportService.getSettings(req.user!.businessId));
  } catch (e) {
    next(e);
  }
});

router.patch('/settings', async (req, res, next) => {
  try {
    res.json(await reportService.updateSettings(req.user!.businessId, req.body));
  } catch (e) {
    next(e);
  }
});

export default router;
