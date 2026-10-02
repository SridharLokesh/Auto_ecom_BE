import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getProfile,
  updateProfile,
  changePassword,
  updateAddresses,
} from '../controllers/userController.js';

const router = express.Router();

router.get('/profile',   protect, getProfile);
router.put('/profile',   protect, updateProfile);
router.put('/password',  protect, changePassword);
router.put('/addresses', protect, updateAddresses);

export default router;