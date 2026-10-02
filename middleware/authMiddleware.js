import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// BUG FIX: check req.user is not null before calling next()
export const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');

      // FIXED: If user was deleted but token still valid, block request
      if (!req.user) {
        return res.status(401).json({ message: 'User no longer exists' });
      }

      // Block inactive accounts
      if (!req.user.isActive) {
        return res.status(403).json({ message: 'Account is deactivated' });
      }

      return next();
    } catch {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

export const adminOnly = (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ message: 'Admin access only' });
};

export const dealerOnly = (req, res, next) => {
  if (req.user?.role === 'dealer') return next();
  return res.status(403).json({ message: 'Dealer access only' });
};

export const dealerOrAdmin = (req, res, next) => {
  if (req.user?.role === 'dealer' || req.user?.role === 'admin') return next();
  return res.status(403).json({ message: 'Dealer or Admin access only' });
};

// Block cart/wishlist for admin and dealer
export const usersOnly = (req, res, next) => {
  if (req.user?.role === 'admin' || req.user?.role === 'dealer') {
    return res.status(403).json({ message: 'Cart and Wishlist are only available for customers' });
  }
  return next();
};
