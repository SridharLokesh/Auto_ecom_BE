// routes/siteSettingsRoutes.js
import express               from 'express';
import multer                from 'multer';
import path                  from 'path';
import fs                    from 'fs';
import { fileURLToPath }     from 'url';
import { getSettings, updateSettings } from '../controllers/siteSettingsController.js';
import { protect, adminOnly } from '../middleware/authMiddleware.js';

const router    = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── ensure upload folders exist ── */
const logosDir = path.join(__dirname, '..', 'uploads', 'logos');
const siteDir  = path.join(__dirname, '..', 'uploads', 'site');
[logosDir, siteDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/* ── disk storage — route each fieldname to its folder ──
   logoLight / footerLogo / logoImage go to /uploads/logos
   everything else (heroBgImage, ctaBgImage, bannerImage_<key>, ...) goes to /uploads/site */
const storage = multer.diskStorage({
  destination: (_req, file, cb) => {
    const inLogos = ['logoLight', 'footerLogo', 'logoImage'].includes(file.fieldname);
    cb(null, inLogos ? logosDir : siteDir);
  },
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${file.fieldname}-${Date.now()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits:     { fileSize: 4 * 1024 * 1024 },          // 4 MB max
  fileFilter: (_req, file, cb) =>
    file.mimetype.startsWith('image/')
      ? cb(null, true)
      : cb(new Error('Only image files are allowed'), false),
});

/* Accept ANY field name in one middleware.
   Needed because:
   - Home Page banners generate dynamic field names (bannerImage_<key>)
     that can't be declared ahead of time with upload.fields([...])
   - Login & Register page uploads logoImage
   - The other sections' fixed fields (logoLight, footerLogo, heroBgImage, ctaBgImage)
     still work fine, upload.any() accepts them too.
   req.files becomes a flat array — see findFile() helper in the controller. */
const uploadAny = upload.any();

/* GET  /api/admin/site-settings  — public (navbar, footer, pages all read this) */
router.get('/', getSettings);

/* POST /api/admin/site-settings  — admin only */
router.post('/', protect, adminOnly, uploadAny, updateSettings);

export default router;