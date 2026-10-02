import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const genToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });

// POST /api/auth/register
export const register = async (req, res) => {
  try {
    let { name, email, password, phone } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'Name, email and password are required' });

    name     = String(name).trim();
    email    = String(email).trim().toLowerCase();
    password = String(password);
    phone    = phone ? String(phone).trim() : '';

    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ message: 'An account with this email already exists' });

    const user = await User.create({ name, email, password, phone });

    return res.status(201).json({
      _id:   user._id,
      name:  user.name,
      email: user.email,
      role:  user.role,
      token: genToken(user._id),
    });
  } catch (err) {
    console.error('[REGISTER]', err.message);
    if (err.code === 11000)
      return res.status(400).json({ message: 'An account with this email already exists' });
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// POST /api/auth/login
// No loginType needed — role is read directly from the DB record
export const login = async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    email    = String(email).trim().toLowerCase();
    password = String(password);

    const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@gmail.com').toLowerCase().trim();
    const ADMIN_PASS  = String(process.env.ADMIN_PASSWORD || 'admin123');

    // ── Admin: auto-seed on first login ────────────────────────────────
    if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
      let admin = await User.findOne({ email: ADMIN_EMAIL });
      if (!admin) {
        admin = await User.create({
          name: 'Admin', email: ADMIN_EMAIL, password: ADMIN_PASS, role: 'admin',
        });
        console.log('[AUTH] Admin account created for the first time');
      }
      return res.json({
        _id:      admin._id,
        name:     admin.name,
        email:    admin.email,
        role:     'admin',
        dealerId: admin.dealerId || '',
        token:    genToken(admin._id),
      });
    }

    // ── All other users: find by email, role comes from DB ─────────────
    const user = await User.findOne({ email });
    if (!user)
      return res.status(401).json({ message: 'Invalid email or password' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch)
      return res.status(401).json({ message: 'Invalid email or password' });

    if (!user.isActive)
      return res.status(403).json({ message: 'Your account has been deactivated. Contact support.' });

    // role is already stored on the user document (user / dealer / admin)
    return res.json({
      _id:          user._id,
      name:         user.name,
      email:        user.email,
      role:         user.role,
      dealerId:     user.dealerId     || '',
      businessName: user.businessName || '',
      token:        genToken(user._id),
    });
  } catch (err) {
    console.error('[LOGIN]', err.message);
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
};