import express from 'express';
import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getStats,
  getUsers,
  toggleUser,
  deleteUser,
  getOrders,
  broadcastNotification,
} from '../controllers/adminController.js';

const router = express.Router();

router.get('/stats',            protect, adminOnly, getStats);
router.get('/users',            protect, adminOnly, getUsers);
router.put('/users/:id/toggle', protect, adminOnly, toggleUser);
router.delete('/users/:id',     protect, adminOnly, deleteUser);
router.get('/orders',           protect, adminOnly, getOrders);
router.post('/notifications',   protect, adminOnly, broadcastNotification);

export default router;