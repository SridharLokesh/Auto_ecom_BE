import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getNearbyInventory,
  selectFulfillment,
  getCartFulfillmentPlan,
  getFulfillmentDebug,
  repairNodeLinks,
} from '../controllers/fulfillmentController.js';

const router = express.Router();

/**
 * Fulfillment discovery/planning APIs (Phase 2 + Phase 3).
 *
 * Read-only: never reserve or deduct inventory. Open to any authenticated
 * account. Only non-sensitive fields (node name, distance, available qty,
 * price) are ever returned — no dealer address/contact details.
 *
 * IMPORTANT (Phase 3): /cart-plan no longer accepts cart items from the
 * client — it loads the authenticated user's own Cart from the database
 * and only accepts { latitude, longitude } in the body. This closes the
 * "trust the frontend for price/dealer/inventory" gap described in the
 * Phase 3 spec (§12/§13).
 */
router.get('/nearby-inventory', protect, getNearbyInventory);
router.post('/select',           protect, selectFulfillment);
router.post('/cart-plan',        protect, getCartFulfillmentPlan);

// Admin-only diagnostic view (Phase 3 §24) — explains WHY each candidate
// is/isn't eligible, not just the winner.
router.get('/debug', protect, adminOnly, getFulfillmentDebug);

// Admin-only maintenance utility (Phase 3 §23) — repairs
// DealerOffer.fulfillmentNodes drift against real InventoryItem locations.
router.post('/repair-links', protect, adminOnly, repairNodeLinks);

export default router;