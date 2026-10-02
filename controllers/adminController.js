import User from '../models/User.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import DealerRequest from '../models/DealerRequest.js';
import Notification from '../models/Notification.js';

// GET /api/admin/stats
export const getStats = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers, activeUsers, newUsersThisMonth,
      totalProducts, outOfStock, lowStockCount,
      totalOrders, deliveredOrders, cancelledOrders,
      revenueData, categoryData, recentOrders,
      totalDealers, pendingDealerRequests,
      orderStatusBreakdown,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', isActive: true }),
      User.countDocuments({ role: 'user', createdAt: { $gte: thirtyDaysAgo } }),
      Product.countDocuments(),
      Product.countDocuments({ stock: 0 }),
      Product.countDocuments({ stock: { $lte: 10, $gt: 0 } }),
      Order.countDocuments(),
      Order.countDocuments({ orderStatus: 'Delivered' }),
      Order.countDocuments({ orderStatus: 'Cancelled' }),
      Order.aggregate([
        { $match: { orderStatus: 'Delivered' } },
        { $group: { _id: null, total: { $sum: '$totalPrice' } } },
      ]),
      Product.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Order.find().sort('-createdAt').limit(5)
        .populate('user', 'name email').lean(),
      User.countDocuments({ role: 'dealer' }),
      DealerRequest.countDocuments({ status: 'pending' }),
      Order.aggregate([
        { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      totalUsers, activeUsers, inactiveUsers: totalUsers - activeUsers, newUsersThisMonth,
      totalProducts, outOfStock, lowStockCount,
      totalOrders, deliveredOrders, cancelledOrders,
      pendingOrders: totalOrders - deliveredOrders - cancelledOrders,
      totalRevenue: revenueData[0]?.total || 0,
      categoryStats: categoryData,
      recentOrders,
      totalDealers, pendingDealerRequests,
      orderStatusBreakdown: orderStatusBreakdown.reduce((acc, s) => {
        acc[s._id] = s.count; return acc;
      }, {}),
    });
  } catch (err) {
    console.error('[admin stats]', err.message);
    res.status(500).json({ message: 'Failed to fetch stats' });
  }
};

// GET /api/admin/users
export const getUsers = async (req, res) => {
  try {
    const { role = 'user', search, page = 1, limit = 20, active } = req.query;
    const query = { role };
    if (search) {
      query.$or = [
        { name:  { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (active !== undefined) query.isActive = active === 'true';

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ users, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/admin/users/:id/toggle — activate / deactivate
export const toggleUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.isActive = !user.isActive;
    await user.save();
    res.json({ message: `User ${user.isActive ? 'activated' : 'deactivated'}`, isActive: user.isActive });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE /api/admin/users/:id
export const deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/admin/orders
export const getOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, dealer } = req.query;
    const query = {};
    if (status) query.orderStatus = status;
    if (dealer) query['orderItems.dealer'] = dealer;

    const total  = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .populate('user', 'name email')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ orders, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/admin/notifications — broadcast deal/arrival
export const broadcastNotification = async (req, res) => {
  try {
    const { type, title, message, link, image, targetRole = 'user' } = req.body;
    if (!title || !message)
      return res.status(400).json({ message: 'Title and message required' });

    const users  = await User.find({ role: targetRole, isActive: true }).select('_id');
    const notifs = users.map(u => ({
      recipient:     u._id,
      recipientRole: targetRole,
      type,
      title,
      message,
      link:  link  || '',
      image: image || '',
    }));

    await Notification.insertMany(notifs);
    res.json({ message: `Notification sent to ${users.length} ${targetRole}s` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};