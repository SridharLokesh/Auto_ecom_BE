import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import DealerRequest from '../models/DealerRequest.js';
import Notification from '../models/Notification.js';
import {
  sendMail,
  dealerRequestAdminMail,
  dealerRequestApplicantMail,
  dealerApprovedMail,
  dealerCreatedByAdminMail,
} from '../utils/email.js';

// POST /api/dealer/request — public
export const submitRequest = async (req, res) => {
  try {
    const { name, email, phone, businessName, businessLocation, state, message } = req.body;
    if (!name || !email || !phone || !businessName || !businessLocation || !state)
      return res.status(400).json({ message: 'All fields are required' });

    const existing = await DealerRequest.findOne({ email, status: 'pending' });
    if (existing)
      return res.status(400).json({ message: 'A pending request from this email already exists' });

    const request = await DealerRequest.create({ name, email, phone, businessName, businessLocation, state, message });
    await sendMail(dealerRequestAdminMail(request));
    await sendMail(dealerRequestApplicantMail(name, email));

    const admin = await User.findOne({ role: 'admin' });
    if (admin) {
      await Notification.create({
        recipient: admin._id, recipientRole: 'admin', type: 'dealer_request',
        title:   'New Dealer Application',
        message: `${name} (${businessName}) has applied to become a dealer`,
        link:    '/admin?tab=dealers',
      });
    }

    res.status(201).json({ message: 'Application submitted! You will receive a confirmation email shortly.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/dealer/requests
export const getRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const requests = await DealerRequest.find(status ? { status } : {}).sort('-createdAt');
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/dealer/approve/:requestId
export const approveRequest = async (req, res) => {
  try {
    const request = await DealerRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    if (request.status === 'approved') return res.status(400).json({ message: 'Already approved' });

    const { dealerId, password } = req.body;
    if (!dealerId || !password)
      return res.status(400).json({ message: 'dealerId and password are required' });

    const dupId = await User.findOne({ dealerId });
    if (dupId) return res.status(400).json({ message: 'Dealer ID already in use' });

    let dealerUser = await User.findOne({ email: request.email });
    if (dealerUser) {
      dealerUser.role             = 'dealer';
      dealerUser.dealerId         = dealerId;
      dealerUser.businessName     = request.businessName;
      dealerUser.businessLocation = request.businessLocation;
      dealerUser.dealerState      = request.state;
      dealerUser.dealerApproved   = true;
      dealerUser.password         = password;
      dealerUser.dealerRequestedAt = request.createdAt;
      await dealerUser.save();
    } else {
      dealerUser = await User.create({
        name: request.name, email: request.email, phone: request.phone,
        password, role: 'dealer', dealerId,
        businessName: request.businessName, businessLocation: request.businessLocation,
        dealerState: request.state, dealerApproved: true, dealerRequestedAt: request.createdAt,
      });
    }

    request.status = 'approved';
    request.userId = dealerUser._id;
    await request.save();

    await sendMail(dealerApprovedMail(request, { dealerId, email: request.email, password }));
    res.json({ message: 'Dealer approved and credentials sent', dealer: dealerUser });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/dealer/reject/:requestId
export const rejectRequest = async (req, res) => {
  try {
    const request = await DealerRequest.findByIdAndUpdate(
      req.params.requestId,
      { status: 'rejected', adminNote: req.body.adminNote || '' },
      { new: true }
    );
    if (!request) return res.status(404).json({ message: 'Request not found' });
    res.json({ message: 'Request rejected', request });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/dealer/all — admin list
export const getAllDealers = async (req, res) => {
  try {
    const { state, search, active } = req.query;
    const query = { role: 'dealer' };
    if (state) query.dealerState = state;
    if (active !== undefined) query.isActive = active === 'true';
    if (search) {
      query.$or = [
        { name:         { $regex: search, $options: 'i' } },
        { email:        { $regex: search, $options: 'i' } },
        { businessName: { $regex: search, $options: 'i' } },
        { dealerId:     { $regex: search, $options: 'i' } },
      ];
    }
    const dealers = await User.find(query).select('-password').sort('-createdAt');
    res.json(dealers);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/dealer/create — admin creates dealer directly
export const createDealer = async (req, res) => {
  try {
    const { name, email, phone, password, dealerId, businessName, businessLocation, state } = req.body;
    if (!name || !email || !phone || !password || !dealerId || !businessName || !businessLocation || !state)
      return res.status(400).json({ message: 'All fields are required' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const emailExists = await User.findOne({ email: email.toLowerCase() });
    if (emailExists) return res.status(400).json({ message: 'An account with this email already exists' });

    const idExists = await User.findOne({ dealerId });
    if (idExists) return res.status(400).json({ message: 'This Dealer ID is already taken' });

    const dealer = await User.create({
      name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(),
      password, role: 'dealer', dealerId: dealerId.trim().toUpperCase(),
      businessName: businessName.trim(), businessLocation: businessLocation.trim(),
      dealerState: state.trim(), dealerApproved: true, isActive: true,
    });

    await sendMail(dealerCreatedByAdminMail({ name, email: dealer.email, dealerId: dealer.dealerId }, password, false));
    const safeDealer = await User.findById(dealer._id).select('-password');
    res.status(201).json({ message: 'Dealer created and credentials emailed', dealer: safeDealer });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Email or Dealer ID already exists' });
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/dealer/:id/edit — admin edits dealer info
export const editDealer = async (req, res) => {
  try {
    const { name, phone, businessName, businessLocation, state, dealerId, isActive } = req.body;
    const dealer = await User.findOne({ _id: req.params.id, role: 'dealer' });
    if (!dealer) return res.status(404).json({ message: 'Dealer not found' });

    if (dealerId && dealerId !== dealer.dealerId) {
      const dup = await User.findOne({ dealerId, _id: { $ne: dealer._id } });
      if (dup) return res.status(400).json({ message: 'Dealer ID already taken' });
      dealer.dealerId = dealerId.trim().toUpperCase();
    }

    if (name)             dealer.name             = name.trim();
    if (phone)            dealer.phone            = phone.trim();
    if (businessName)     dealer.businessName     = businessName.trim();
    if (businessLocation) dealer.businessLocation = businessLocation.trim();
    if (state)            dealer.dealerState      = state.trim();
    if (isActive !== undefined) dealer.isActive   = Boolean(isActive);

    await dealer.save();
    const safe = await User.findById(dealer._id).select('-password');
    res.json({ message: 'Dealer updated', dealer: safe });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/dealer/:id/reset-password
export const resetDealerPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const dealer = await User.findOne({ _id: req.params.id, role: 'dealer' });
    if (!dealer) return res.status(404).json({ message: 'Dealer not found' });

    dealer.password = newPassword;
    await dealer.save();

    await sendMail(dealerCreatedByAdminMail(
      { name: dealer.name, email: dealer.email, dealerId: dealer.dealerId },
      newPassword, true
    ));
    res.json({ message: 'Password reset and new credentials emailed to dealer' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/dealer/:id
export const deleteDealer = async (req, res) => {
  try {
    const dealer = await User.findOne({ _id: req.params.id, role: 'dealer' });
    if (!dealer) return res.status(404).json({ message: 'Dealer not found' });
    await Product.updateMany({ dealer: dealer._id }, { $set: { dealer: null } });
    await dealer.deleteOne();
    res.json({ message: 'Dealer deleted. Their products transferred to admin.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/dealer/:dealerId/toggle
export const toggleDealer = async (req, res) => {
  try {
    const dealer = await User.findOne({ dealerId: req.params.dealerId, role: 'dealer' });
    if (!dealer) return res.status(404).json({ message: 'Dealer not found' });
    dealer.isActive = !dealer.isActive;
    await dealer.save();
    res.json({ message: `Dealer ${dealer.isActive ? 'activated' : 'suspended'}`, dealer });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/dealer/profile
export const getDealerProfile = async (req, res) => {
  try {
    const dealer = await User.findById(req.user._id).select('-password');
    res.json(dealer);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/dealer/stats
export const getDealerStats = async (req, res) => {
  try {
    const dealerId = req.user._id;

    const [totalProducts, categoryStats, lowStock] = await Promise.all([
      Product.countDocuments({ dealer: dealerId }),
      Product.aggregate([
        { $match: { dealer: dealerId } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Product.find({ dealer: dealerId, stock: { $lte: 5, $gt: 0 } }).select('title stock').limit(5),
    ]);

    const allOrders   = await Order.find({ 'orderItems.dealer': dealerId }).populate('user', 'name email');
    const totalOrders = allOrders.length;
    const liveOrders  = allOrders.filter(o => ['Placed', 'Processing', 'Packed'].includes(o.orderStatus)).length;
    const revenue = allOrders
      .filter(o => o.orderStatus === 'Delivered')
      .reduce((sum, o) => {
        const items = o.orderItems.filter(i => i.dealer?.toString() === dealerId.toString());
        return sum + items.reduce((s, i) => s + i.price * i.quantity, 0);
      }, 0);
    const statusBreakdown = allOrders.reduce((acc, o) => {
      acc[o.orderStatus] = (acc[o.orderStatus] || 0) + 1; return acc;
    }, {});
    const recentOrders = [...allOrders].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);

    res.json({ totalProducts, categoryStats, lowStock, totalOrders, liveOrders, revenue, statusBreakdown, recentOrders });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ═══════════════════════════════════════════════════════════════
   INVOICE SETTINGS — dealer self-service branding for invoices
═══════════════════════════════════════════════════════════════ */

// GET /api/dealer/invoice-settings — dealer's own settings (dealer only)
export const getMyInvoiceSettings = async (req, res) => {
  try {
    const dealer = await User.findById(req.user._id).select('invoiceSettings businessName dealerId email phone businessLocation');
    if (!dealer) return res.status(404).json({ message: 'Dealer not found' });

    // Return with sensible fallbacks pre-filled from the dealer's account,
    // so the settings form starts populated even before the dealer edits anything.
    const s = dealer.invoiceSettings || {};
    res.json({
      businessName:  s.businessName  || dealer.businessName || '',
      logo:          s.logo          || '',
      gstin:         s.gstin         || '',
      address:       s.address       || dealer.businessLocation || '',
      phone:         s.phone         || dealer.phone || '',
      email:         s.email         || dealer.email || '',
      bankName:      s.bankName      || '',
      accountNumber: s.accountNumber || '',
      ifsc:          s.ifsc          || '',
      upiId:         s.upiId         || '',
      footerNote:    s.footerNote    || 'Thank you for your business!',
      invoicePrefix: s.invoicePrefix || 'INV',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/dealer/invoice-settings — dealer updates own settings (dealer only, multipart for logo)
export const updateMyInvoiceSettings = async (req, res) => {
  try {
    const dealer = await User.findById(req.user._id);
    if (!dealer) return res.status(404).json({ message: 'Dealer not found' });

    const {
      businessName, gstin, address, phone, email,
      bankName, accountNumber, ifsc, upiId, footerNote, invoicePrefix,
    } = req.body;

    if (!dealer.invoiceSettings) dealer.invoiceSettings = {};

    if (businessName  != null) dealer.invoiceSettings.businessName  = businessName;
    if (gstin          != null) dealer.invoiceSettings.gstin         = gstin;
    if (address         != null) dealer.invoiceSettings.address       = address;
    if (phone           != null) dealer.invoiceSettings.phone         = phone;
    if (email           != null) dealer.invoiceSettings.email         = email;
    if (bankName        != null) dealer.invoiceSettings.bankName      = bankName;
    if (accountNumber   != null) dealer.invoiceSettings.accountNumber = accountNumber;
    if (ifsc            != null) dealer.invoiceSettings.ifsc          = ifsc;
    if (upiId           != null) dealer.invoiceSettings.upiId         = upiId;
    if (footerNote      != null) dealer.invoiceSettings.footerNote    = footerNote;
    if (invoicePrefix   != null) dealer.invoiceSettings.invoicePrefix = invoicePrefix.toUpperCase().slice(0, 10);

    const logoFile = (req.files || []).find(f => f.fieldname === 'logo');
    if (logoFile) dealer.invoiceSettings.logo = `/uploads/dealers/${logoFile.filename}`;

    dealer.markModified('invoiceSettings');
    await dealer.save();

    res.json({ message: 'Invoice settings saved', invoiceSettings: dealer.invoiceSettings });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/dealer/invoice-settings/public/:dealerId — public read, used by the
// customer's invoice page to render that dealer's branded invoice block.
export const getPublicInvoiceSettings = async (req, res) => {
  try {
    const dealer = await User.findOne({ _id: req.params.dealerId, role: 'dealer' })
      .select('invoiceSettings businessName dealerId businessLocation phone email');
    if (!dealer) return res.status(404).json({ message: 'Dealer not found' });

    const s = dealer.invoiceSettings || {};
    res.json({
      dealerId:      dealer.dealerId,
      businessName:  s.businessName  || dealer.businessName || 'Dealer',
      logo:          s.logo          || '',
      gstin:         s.gstin         || '',
      address:       s.address       || dealer.businessLocation || '',
      phone:         s.phone         || dealer.phone || '',
      email:         s.email         || dealer.email || '',
      bankName:      s.bankName      || '',
      accountNumber: s.accountNumber || '',
      ifsc:          s.ifsc          || '',
      upiId:         s.upiId         || '',
      footerNote:    s.footerNote    || 'Thank you for your business!',
      invoicePrefix: s.invoicePrefix || 'INV',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};