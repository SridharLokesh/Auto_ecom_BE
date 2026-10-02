import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getNotifications,
  markRead,
  markAllRead,
  deleteNotification,
} from '../controllers/notificationController.js';

const router = express.Router();

// IMPORTANT: /read-all/all must be declared before /:id to avoid being matched as an id
router.get('/',               protect, getNotifications);
router.put('/read-all/all',   protect, markAllRead);
router.put('/:id/read',       protect, markRead);
router.delete('/:id',         protect, deleteNotification);

export default router;