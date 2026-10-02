import express from 'express';
import { protect, adminOnly, dealerOnly, usersOnly } from '../middleware/authMiddleware.js';
import {
  placeOrder,
  getMyOrders,
  getAllOrders,
  getDealerOrders,
  getOrderById,
  cancelOrder,
  updateDealerStatus,
  updateOrderStatus,
  returnOrder,
  createOrderFromCheckoutSession,
  getOrderFulfillment,
  getOrderTimeline,
} from '../controllers/orderController.js';

const router = express.Router();

// IMPORTANT: specific paths must come before /:id to avoid route clashes

// Phase 5 — the checkout-session-based creation path (§16). Reuses the
// existing legacy POST '/' below unchanged for backward compatibility;
// the frontend has been updated to call this new route instead.
router.post('/from-checkout', protect, usersOnly, createOrderFromCheckoutSession);

router.post('/',               protect, usersOnly,  placeOrder);
router.get('/my',              protect,             getMyOrders);
router.get('/all',             protect, adminOnly,  getAllOrders);
router.get('/dealer',          protect, dealerOnly, getDealerOrders);
router.get('/:id',             protect,             getOrderById);
router.get('/:id/fulfillment', protect,             getOrderFulfillment);
router.get('/:id/timeline',    protect,             getOrderTimeline);
router.put('/:id/cancel',      protect, usersOnly,  cancelOrder);
router.put('/:id/dealer-status', protect, dealerOnly, updateDealerStatus);
router.put('/:id/status',      protect, adminOnly,  updateOrderStatus);
router.put('/:id/return',      protect, usersOnly,  returnOrder);

export default router;