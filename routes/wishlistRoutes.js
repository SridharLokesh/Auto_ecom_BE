import express from 'express';
import { protect, usersOnly } from '../middleware/authMiddleware.js';
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
} from '../controllers/wishlistController.js';

const router = express.Router();

router.use(protect, usersOnly);

router.get('/',                     getWishlist);
router.post('/add',                 addToWishlist);
router.delete('/remove/:productId', removeFromWishlist);

export default router;