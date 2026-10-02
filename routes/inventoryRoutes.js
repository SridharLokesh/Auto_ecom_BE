import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import express from 'express';
import { protect, dealerOrAdmin, adminOnly } from '../middleware/authMiddleware.js';
import {
  getAllInventory,
  getProductInventory,
  getDealerInventory,
  getNodeInventory,
  updateInventory,
  createInventory,
  migrateInventory,
} from '../controllers/inventoryController.js';

const router = express.Router();

// Debug endpoint to inspect rawimport dns from 'node:dns';
router.get('/debug/raw', protect, adminOnly, async (req, res) => {
  try {
    const items = await (await import('../models/InventoryItem.js')).default
      .find()
      .limit(1)
      .lean();
    
    const item = items[0];
    if (!item) return res.json({ message: 'No inventory items found' });
    
    res.json({
      message: 'Raw inventory item (first)',
      _id: item._id,
      product_ref: item.product,
      dealer_ref: item.dealer,
      fulfillmentNode_ref: item.fulfillmentNode,
      onHand: item.onHand,
      stock_value: item.stock,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// All inventory endpoints require a dealer or admin session.
// Customers receive 403 via `dealerOrAdmin` — inventory is never public.
router.get('/',               protect, dealerOrAdmin, getAllInventory);
router.get('/product/:productId', protect, dealerOrAdmin, getProductInventory);
router.get('/dealer/:dealerId',   protect, dealerOrAdmin, getDealerInventory);
router.get('/node/:nodeId',       protect, dealerOrAdmin, getNodeInventory);
router.post('/',               protect, dealerOrAdmin, createInventory);
router.post('/migrate',        protect, adminOnly,      migrateInventory);
router.put('/:id',             protect, dealerOrAdmin, updateInventory);

export default router;