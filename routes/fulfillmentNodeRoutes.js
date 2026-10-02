import express from 'express';
import { protect, dealerOrAdmin } from '../middleware/authMiddleware.js';
import {
  getFulfillmentNodes,
  getFulfillmentNodeById,
  createFulfillmentNode,
  updateFulfillmentNode,
} from '../controllers/fulfillmentNodeController.js';

const router = express.Router();

// ADMIN → full access. DEALER → own nodes only. CUSTOMER → 403 (dealerOrAdmin).
router.get('/',       protect, dealerOrAdmin, getFulfillmentNodes);
router.get('/:id',    protect, dealerOrAdmin, getFulfillmentNodeById);
router.post('/',      protect, dealerOrAdmin, createFulfillmentNode);
router.put('/:id',    protect, dealerOrAdmin, updateFulfillmentNode);

export default router;