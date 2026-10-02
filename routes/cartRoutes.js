import express from 'express';
import { protect, usersOnly } from '../middleware/authMiddleware.js';
import {
  getCart,
  addToCart,
  updateCart,
  removeFromCart,
  clearCart,
} from '../controllers/cartController.js';

const router = express.Router();

// All cart routes — authenticated users only
router.use(protect, usersOnly);

router.get('/',                   getCart);
router.post('/add',               addToCart);
router.put('/update',             updateCart);
router.delete('/remove/:productId', removeFromCart);
router.delete('/clear',           clearCart);

export default router;