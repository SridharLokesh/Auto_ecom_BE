import express from 'express';
import { protect, dealerOrAdmin } from '../middleware/authMiddleware.js';
import {
  getOffersForProduct,
  getOffersForDealer,
  createOffer,
  updateOffer,
} from '../controllers/dealerOfferController.js';

const router = express.Router();

// DealerOffers are commercial data — dealer or admin only.
// Customers will see offers through the product/inventory read path (Phase 2).
router.get('/product/:productId', protect, dealerOrAdmin, getOffersForProduct);
router.get('/dealer/:dealerId',   protect, dealerOrAdmin, getOffersForDealer);
router.post('/',                  protect, dealerOrAdmin, createOffer);
router.put('/:id',                protect, dealerOrAdmin, updateOffer);

export default router;