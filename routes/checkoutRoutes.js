import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import { postValidateCheckout, postReleaseCheckout, getCheckoutDebug, postCreateOrderFromCheckout } from '../controllers/checkoutController.js';

const router = express.Router();

/**
 * Phase 4 — checkout revalidation + inventory reservation.
 * Every route requires an authenticated user; userId is always taken
 * from `req.user._id`, never from the request body (§22).
 */
router.post('/validate', protect, postValidateCheckout);
router.post('/release',  protect, postReleaseCheckout);
router.post('/order',    protect, postCreateOrderFromCheckout);

// Admin-only diagnostic dump (§23) — never exposed to customers.
router.get('/debug/:sessionId', protect, adminOnly, getCheckoutDebug);

export default router;