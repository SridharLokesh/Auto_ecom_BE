import express from 'express';
import { protect, dealerOrAdmin } from '../middleware/authMiddleware.js';
import {
  listFulfillmentGroups,
  getFulfillmentGroupDetail,
  postConfirm,
  postStartPicking,
  postCompletePicking,
  postPack,
  postReadyForDispatch,
  postAssignDelivery,
  postOutForDelivery,
  postDelivered,
  postCancel,
} from '../controllers/fulfillmentGroupController.js';

const router = express.Router();

/**
 * Phase 6 — operational fulfillment lifecycle.
 * Every route is dealer-or-admin: a dealer only ever sees/touches their
 * own groups (enforced inside the controller via authorizeGroupAccess,
 * not just by role) — customers have no access here at all (§17).
 */
router.get('/',  protect, dealerOrAdmin, listFulfillmentGroups);
router.get('/:id', protect, dealerOrAdmin, getFulfillmentGroupDetail);

router.post('/:id/confirm',             protect, dealerOrAdmin, postConfirm);
router.post('/:id/start-picking',       protect, dealerOrAdmin, postStartPicking);
router.post('/:id/complete-picking',    protect, dealerOrAdmin, postCompletePicking);
router.post('/:id/pack',                protect, dealerOrAdmin, postPack);
router.post('/:id/ready-for-dispatch',  protect, dealerOrAdmin, postReadyForDispatch);
router.post('/:id/assign-delivery',     protect, dealerOrAdmin, postAssignDelivery);
router.post('/:id/out-for-delivery',    protect, dealerOrAdmin, postOutForDelivery);
router.post('/:id/delivered',           protect, dealerOrAdmin, postDelivered);
router.post('/:id/cancel',              protect, dealerOrAdmin, postCancel);

export default router;