import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { protect, adminOnly, dealerOnly } from '../middleware/authMiddleware.js';
import {
  submitRequest,
  getRequests,
  approveRequest,
  rejectRequest,
  getAllDealers,
  createDealer,
  editDealer,
  resetDealerPassword,
  deleteDealer,
  toggleDealer,
  getDealerProfile,
  getDealerStats,
  getMyInvoiceSettings,
  updateMyInvoiceSettings,
  getPublicInvoiceSettings
} from '../controllers/dealerController.js';
import { getDealerFulfillmentGroups } from '../controllers/orderController.js';

const router    = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── upload folder for dealer invoice logos ── */
const dealersDir = path.join(__dirname, '..', 'uploads', 'dealers');
if (!fs.existsSync(dealersDir)) fs.mkdirSync(dealersDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dealersDir),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    cb(null, `logo-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits:     { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) =>
    file.mimetype.startsWith('image/')
      ? cb(null, true)
      : cb(new Error('Only image files are allowed'), false),
});
const uploadAny = upload.any();

// Public
router.post('/request', submitRequest);

// Admin only
router.get('/requests',               protect, adminOnly, getRequests);
router.post('/approve/:requestId',    protect, adminOnly, approveRequest);
router.put('/reject/:requestId',      protect, adminOnly, rejectRequest);
router.get('/all',                    protect, adminOnly, getAllDealers);
router.post('/create',                protect, adminOnly, createDealer);
router.put('/:id/edit',              protect, adminOnly, editDealer);
router.put('/:id/reset-password',    protect, adminOnly, resetDealerPassword);
router.delete('/:id',                protect, adminOnly, deleteDealer);
router.put('/:dealerId/toggle',      protect, adminOnly, toggleDealer);

// Dealer self-service
router.get('/profile', protect, dealerOnly, getDealerProfile);
router.get('/stats',   protect, dealerOnly, getDealerStats);

// Phase 5 — dealer's own fulfillment groups (never another dealer's, §14/§20)
router.get('/fulfillment-groups', protect, dealerOnly, getDealerFulfillmentGroups);

// Invoice settings — dealer self-service (own account)
router.get('/invoice-settings',  protect, dealerOnly, getMyInvoiceSettings);
router.put('/invoice-settings',  protect, dealerOnly, uploadAny, updateMyInvoiceSettings);

// Invoice settings — public read, used by the customer invoice page to render
// each dealer's branded block for orders that include their products
router.get('/invoice-settings/public/:dealerId', getPublicInvoiceSettings);



export default router;