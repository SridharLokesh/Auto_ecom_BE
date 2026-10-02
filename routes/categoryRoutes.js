import express from 'express';

import { protect, adminOnly } from '../middleware/authMiddleware.js';
import {
  getCategories,
  getCategoryBySlug,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from '../controllers/CategoryController.js';

const router = express.Router();

// Public routes
router.get('/',          getCategories);

// Admin-only — must come before /:slug to avoid slug matching 'admin'
router.get('/admin/all', protect, adminOnly, getAllCategories);
router.post('/',         protect, adminOnly, createCategory);
router.put('/reorder',   protect, adminOnly, reorderCategories);
router.put('/:id',       protect, adminOnly, updateCategory);
router.delete('/:id',    protect, adminOnly, deleteCategory);

// Public slug lookup — last so it doesn't swallow admin routes
router.get('/:slug',     getCategoryBySlug);


export default router;