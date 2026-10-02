import User from '../models/User.js';

// GET /api/user/profile
export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/user/profile
export const updateProfile = async (req, res) => {
  try {
    const { name, phone, secondaryPhone, avatar } = req.body;
    const updates = {};
    if (name           !== undefined) updates.name           = String(name).trim();
    if (phone          !== undefined) updates.phone          = String(phone).trim();
    if (secondaryPhone !== undefined) updates.secondaryPhone = String(secondaryPhone).trim();
    if (avatar         !== undefined) updates.avatar         = avatar;

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/user/password
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Both passwords required' });
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'New password must be at least 6 characters' });

    const user = await User.findById(req.user._id);
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch)
      return res.status(401).json({ message: 'Current password is incorrect' });

    user.password = newPassword; // triggers pre-save hash
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/user/addresses
export const updateAddresses = async (req, res) => {
  try {
    const { addresses } = req.body;
    if (!Array.isArray(addresses))
      return res.status(400).json({ message: 'Addresses must be an array' });
    if (addresses.length > 10)
      return res.status(400).json({ message: 'Maximum 10 addresses allowed' });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { addresses },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};