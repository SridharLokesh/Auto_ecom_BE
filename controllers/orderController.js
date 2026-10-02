import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import FulfillmentGroup from '../models/FulfillmentGroup.js';
import FulfillmentEvent from '../models/FulfillmentEvent.js';
import { sendMail, orderStatusMail } from '../utils/email.js';
import { createOrderFromCheckout } from '../services/order/orderService.js';

// POST /api/orders/from-checkout — Phase 5: the real, integrity-checked
// order creation path. Converts a validated/reserved CheckoutSession
// (Phase 4) into a real Order + FulfillmentGroups. The client sends only
// checkoutSessionId (+ non-financial shippingAddress/paymentMethod) —
// quantity/price/dealer/inventory are always derived server-side from the
// session's committed reservations (§26/§27), never from this request body.
export const createOrderFromCheckoutSession = async (req, res) => {
  try {
    const { checkoutSessionId, shippingAddress, paymentMethod } = req.body;
    if (!checkoutSessionId) {
      return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'checkoutSessionId is required.' });
    }
    if (!shippingAddress) {
      return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'shippingAddress is required.' });
    }

    const result = await createOrderFromCheckout({
      checkoutSessionId,
      userId: req.user._id,
      shippingAddress,
      paymentMethod,
    });

    if (!result.success) {
      const status = { CHECKOUT_SESSION_NOT_FOUND: 404, FORBIDDEN: 403 }[result.code] || 409;
      return res.status(status).json({ success: false, code: result.code, message: ORDER_ERROR_MESSAGES[result.code] || 'Unable to create order.' });
    }

    res.status(result.idempotent ? 200 : 201).json({
      success: true,
      message: result.idempotent ? 'Order already created for this checkout session.' : 'Order created successfully',
      order: result.order,
    });
  } catch (err) {
    console.error('[createOrderFromCheckoutSession]', err);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
};

const ORDER_ERROR_MESSAGES = {
  CHECKOUT_SESSION_NOT_FOUND: 'Checkout session not found.',
  FORBIDDEN: 'This checkout session does not belong to you.',
  CHECKOUT_SESSION_CANCELLED: 'This checkout session was cancelled. Please start checkout again.',
  CHECKOUT_SESSION_EXPIRED: 'Your checkout session has expired. Please try again.',
  CHECKOUT_SESSION_INVALID: 'This checkout session is no longer valid.',
  RESERVATION_NOT_FOUND: 'Your inventory hold has expired or was released. Please try again.',
};

// GET /api/dealer/fulfillment-groups — dealer sees only their own groups.
export const getDealerFulfillmentGroups = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = { dealer: req.user._id };
    if (status) query.status = status;

    const total = await FulfillmentGroup.countDocuments(query);
    const groups = await FulfillmentGroup.find(query)
      .populate('order', 'orderNumber orderStatus createdAt user')
      .populate('fulfillmentNode', 'name type')
      .populate('items.product', 'title image')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ groups, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/orders — place order (users only)
export const placeOrder = async (req, res) => {
  try {
    const { shippingAddress, paymentMethod, orderItems, itemsPrice, totalPrice } = req.body;
    if (!orderItems?.length) return res.status(400).json({ message: 'No items in order' });

    const enrichedItems = [];
    for (const item of orderItems) {
      const product = await Product.findById(item.product);
      if (!product)
        return res.status(404).json({ message: `Product not found: ${item.product}` });
      if (product.stock < item.quantity)
        return res.status(400).json({ message: `Insufficient stock for ${product.title}` });

      product.stock -= item.quantity;
      await product.save();

      enrichedItems.push({ ...item, dealer: product.dealer || null });
    }

    const order = await Order.create({
      user: req.user._id,
      orderItems: enrichedItems,
      shippingAddress,
      paymentMethod: paymentMethod || 'COD',
      itemsPrice,
      totalPrice,
    });

    // Clear cart after order
    await Cart.findOneAndUpdate({ user: req.user._id }, { items: [], totalPrice: 0 });

    // Notify dealers whose products are in this order
    const dealerIds = [...new Set(enrichedItems.filter(i => i.dealer).map(i => i.dealer.toString()))];
    for (const dealerId of dealerIds) {
      await Notification.create({
        recipient:     dealerId,
        recipientRole: 'dealer',
        type:          'new_order',
        title:         'New Order Received',
        message:       `New order #${order.invoiceNumber} placed for your product(s)`,
        link:          '/dealer/orders',
        refOrder:      order._id,
      });
    }

    // Notify buyer
    await Notification.create({
      recipient:     req.user._id,
      recipientRole: 'user',
      type:          'order_status',
      title:         'Order Placed!',
      message:       `Your order #${order.invoiceNumber} has been placed successfully`,
      link:          '/profile?tab=orders',
      refOrder:      order._id,
    });

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/orders/my — user's own orders
export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id })
      .populate('orderItems.product', 'title image')
      .populate('orderItems.dealer', 'name businessName dealerId')
      .populate('fulfillmentGroups')
      .sort('-createdAt');
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/orders/all — admin all orders
export const getAllOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query  = status ? { orderStatus: status } : {};
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

// GET /api/orders/dealer — dealer's orders
export const getDealerOrders = async (req, res) => {
  try {
    const { status } = req.query;
    const query = { 'orderItems.dealer': req.user._id };
    if (status) query.orderStatus = status;

    const orders = await Order.find(query)
      .populate('user', 'name email phone')
      .populate('orderItems.product', 'title image price')
      .sort('-createdAt');

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/orders/:id
export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('user', 'name email phone')
      .populate('orderItems.product', 'title image brand')
      .populate('orderItems.dealer', 'name businessName dealerId')
      .populate('fulfillmentGroups');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (req.user.role === 'user' && order.user._id.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized' });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/orders/:id/cancel — user cancel
export const cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.user.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized' });
    if (['Shipped', 'Delivered'].includes(order.orderStatus))
      return res.status(400).json({ message: 'Cannot cancel a shipped or delivered order' });

    // Restore stock
    for (const item of order.orderItems) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
    }

    order.orderStatus = 'Cancelled';
    await order.save();

    await Notification.create({
      recipient:     req.user._id,
      recipientRole: 'user',
      type:          'order_status',
      title:         'Order Cancelled',
      message:       `Your order #${order.invoiceNumber} has been cancelled`,
      refOrder:      order._id,
    });

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/orders/:id/dealer-status — dealer packs / ships
export const updateDealerStatus = async (req, res) => {
  try {
    const { status, trackingNumber } = req.body;
    const allowed = ['Processing', 'Packed', 'Shipped'];
    if (!allowed.includes(status))
      return res.status(400).json({ message: 'Invalid status for dealer update' });

    const order = await Order.findById(req.params.id).populate('user', 'name email');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const hasItem = order.orderItems.some(
      i => i.dealer?.toString() === req.user._id.toString()
    );
    if (!hasItem) return res.status(403).json({ message: 'Not authorized for this order' });

    if (status === 'Packed') {
      order.orderItems.forEach(item => {
        if (item.dealer?.toString() === req.user._id.toString())
          item.dealerPackedAt = new Date();
      });
    }

    order.orderStatus = status;
    if (trackingNumber) order.trackingNumber = trackingNumber;
    await order.save();

    await Notification.create({
      recipient:     order.user._id,
      recipientRole: 'user',
      type:          'order_status',
      title:         `Order ${status}`,
      message:       `Your order #${order.invoiceNumber} is now ${status}${trackingNumber ? ` (Tracking: ${trackingNumber})` : ''}`,
      link:          '/profile?tab=orders',
      refOrder:      order._id,
    });

    await sendMail(orderStatusMail(order, order.user));
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/orders/:id/status — admin update
export const updateOrderStatus = async (req, res) => {
  try {
    const { status, trackingNumber, notes } = req.body;
    const order = await Order.findById(req.params.id).populate('user', 'name email');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    order.orderStatus = status;
    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (notes)          order.notes          = notes;
    if (status === 'Delivered') {
      order.isDelivered = true;
      order.deliveredAt = new Date();
    }
    await order.save();

    await Notification.create({
      recipient:     order.user._id,
      recipientRole: 'user',
      type:          'order_status',
      title:         `Order ${status}`,
      message:       `Your order #${order.invoiceNumber} has been marked as ${status}`,
      link:          '/profile?tab=orders',
      refOrder:      order._id,
    });

    await sendMail(orderStatusMail(order, order.user));
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/orders/:id/return — user requests return (within 7 days of delivery)
export const returnOrder = async (req, res) => {
  try {
    const { reason, itemIds } = req.body;
    if (!reason?.trim())
      return res.status(400).json({ message: 'Return reason is required' });

    const order = await Order.findById(req.params.id).populate('user', 'name email');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (order.user._id.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized' });

    if (order.orderStatus !== 'Delivered')
      return res.status(400).json({ message: 'Only delivered orders can be returned' });

    const deliveryDate       = new Date(order.deliveredAt || order.updatedAt);
    const daysSinceDelivery  = Math.floor((Date.now() - deliveryDate) / (1000 * 60 * 60 * 24));
    if (daysSinceDelivery > 7)
      return res.status(400).json({ message: 'Return window has expired. Returns are accepted within 7 days of delivery.' });

    order.orderStatus = 'Returned';
    order.notes       = `Return reason: ${reason}`;
    await order.save();

    // Restore stock for returned items
    for (const item of order.orderItems) {
      if (!itemIds || itemIds.includes(item.product?.toString())) {
        await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
      }
    }

    await Notification.create({
      recipient:     req.user._id,
      recipientRole: 'user',
      type:          'order_status',
      title:         'Return Request Submitted',
      message:       `Your return request for order #${order.invoiceNumber} has been submitted. Our team will process it within 3-5 business days.`,
      link:          '/profile?tab=returns',
      refOrder:      order._id,
    });

    const admin = await User.findOne({ role: 'admin' });
    if (admin) {
      await Notification.create({
        recipient:     admin._id,
        recipientRole: 'admin',
        type:          'complaint',
        title:         'New Return Request',
        message:       `${req.user.name} requested a return for order #${order.invoiceNumber}. Reason: ${reason}`,
        refOrder:      order._id,
      });
    }

    res.json({ message: 'Return request submitted successfully', order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/orders/:id/fulfillment — Phase 6 (§19): the order plus every
// fulfillment group's live status, for the customer order-tracking view.
export const getOrderFulfillment = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate({
      path: 'fulfillmentGroups',
      populate: [
        { path: 'fulfillmentNode', select: 'name type' },
        { path: 'dealer', select: 'name businessName' },
        { path: 'items.product', select: 'title image' },
        { path: 'deliveryAssignment' },
      ],
    });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const isOwner = order.user.toString() === req.user._id.toString();
    const isDealerOnOrder = order.fulfillmentGroups?.some((g) => String(g.dealer?._id || g.dealer) === String(req.user._id));
    if (req.user.role === 'user' && !isOwner) return res.status(403).json({ message: 'Not authorized' });
    if (req.user.role === 'dealer' && !isDealerOnOrder) return res.status(403).json({ message: 'Not authorized' });

    res.json({
      orderNumber: order.orderNumber,
      orderStatus: order.orderStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      fulfillmentGroups: order.fulfillmentGroups,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/orders/:id/timeline — full audit history across all of this
// order's fulfillment groups, oldest first.
export const getOrderTimeline = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).select('user fulfillmentGroups');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (req.user.role === 'user' && order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (req.user.role === 'dealer') {
      const groups = await FulfillmentGroup.find({ order: order._id }).select('dealer').lean();
      const ownsAny = groups.some((g) => String(g.dealer) === String(req.user._id));
      if (!ownsAny) return res.status(403).json({ message: 'Not authorized' });
    }

    const events = await FulfillmentEvent.find({ order: order._id })
      .populate('performedBy', 'name role')
      .sort('createdAt')
      .lean();

    res.json({ events });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};