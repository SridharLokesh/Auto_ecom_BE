import CheckoutSession from '../models/CheckoutSession.js';
import InventoryReservation from '../models/InventoryReservation.js';
import InventoryItem from '../models/InventoryItem.js';
import { validateCheckout } from '../services/checkout/checkoutValidationService.js';
import { releaseReservationsForSession } from '../services/inventory/reservationService.js';
import { createOrderFromCheckout } from '../services/order/orderService.js';
import {
  resolveCustomerLocation,
  CustomerLocationError,
} from '../services/fulfillment/customerLocationService.js';

const log = (event, payload = {}) => console.log(JSON.stringify({ event, ...payload, at: new Date().toISOString() }));

/* ── POST /api/checkout/validate ────────────────────────────────────────
    { latitude, longitude } — always the AUTHENTICATED user's own cart. */
export const postValidateCheckout = async (req, res) => {
  try {
    // Location = explicit { latitude, longitude } OR { addressId } of one of
    // the authenticated user's saved addresses (geocoded + cached on demand).
    let loc;
    try {
      loc = await resolveCustomerLocation({
        userId: req.user._id,
        addressId: req.body?.addressId,
        latitude: req.body?.latitude,
        longitude: req.body?.longitude,
      });
    } catch (locErr) {
      if (locErr instanceof CustomerLocationError) {
        return res.status(locErr.status).json({ success: false, code: locErr.code, message: locErr.message });
      }
      throw locErr;
    }
    const result = await validateCheckout({ userId: req.user._id, latitude: loc.latitude, longitude: loc.longitude });

    if (!result.success) {
      const status = result.code === 'INVALID_LOCATION' || result.code === 'EMPTY_CART' ? 400 : 409;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
};

/* ── POST /api/checkout/release ─────────────────────────────────────────
    { checkoutSessionId } — idempotent: releasing twice is a no-op the
    second time (releaseReservation only decrements on the ACTIVE→RELEASED
    flip it itself wins — see reservationService). */
export const postReleaseCheckout = async (req, res) => {
  try {
    const { checkoutSessionId } = req.body;
    if (!checkoutSessionId) {
      return res.status(400).json({ success: false, code: 'INVALID_REQUEST', message: 'checkoutSessionId is required.' });
    }

    const session = await CheckoutSession.findOne({ sessionId: checkoutSessionId });
    if (!session) {
      return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Checkout session not found.' });
    }
    // Ownership: users may only release their own session (§22).
    if (String(session.user) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Not your checkout session.' });
    }

    await releaseReservationsForSession(session._id);

    if (session.status === 'ACTIVE') {
      session.status = 'CANCELLED';
      await session.save();
    }

    log('INVENTORY_RESERVATION_RELEASED', { userId: req.user._id, checkoutSessionId });
    res.json({ success: true, checkoutSessionId, status: session.status });
  } catch (err) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
};

/* ── POST /api/checkout/order ───────────────────────────────────────────
    { checkoutSessionId, shippingAddress, paymentMethod } — creates an order
    from a validated checkout session. */
export const postCreateOrderFromCheckout = async (req, res) => {
  try {
    const { checkoutSessionId, shippingAddress, paymentMethod = 'COD' } = req.body;
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
      let status = 400;
      switch (result.code) {
        case 'CHECKOUT_SESSION_NOT_FOUND':
        case 'FORBIDDEN':
          status = 404;
          break;
        case 'CHECKOUT_SESSION_CANCELLED':
        case 'CHECKOUT_SESSION_EXPIRED':
        case 'CHECKOUT_SESSION_INVALID':
        case 'RESERVATION_NOT_FOUND':
          status = 409;
          break;
        default:
          status = 400;
      }
      return res.status(status).json({ success: false, code: result.code });
    }

    log('ORDER_CREATED_FROM_CHECKOUT', { userId: req.user._id, checkoutSessionId, orderId: result.order._id });
    res.json({ success: true, order: result.order });
  } catch (err) {
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
};

/* ── GET /api/checkout/debug/:sessionId ─────────────────────────────────
    Admin-only diagnostic dump (§23). */
export const getCheckoutDebug = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await CheckoutSession.findOne({ sessionId }).lean();
    if (!session) return res.status(404).json({ message: 'Checkout session not found.' });

    const reservations = await InventoryReservation.find({ checkoutSession: session._id })
      .populate('product', 'title')
      .populate('dealer', 'name businessName')
      .populate('fulfillmentNode', 'name isActive serviceRadiusKm location')
      .lean();

    const inventoryIds = reservations.map((r) => r.inventoryItem);
    const inventoryRows = await InventoryItem.find({ _id: { $in: inventoryIds } }).lean();
    const inventoryById = new Map(inventoryRows.map((i) => [String(i._id), i]));

    res.json({
      session,
      reservations: reservations.map((r) => {
        const inv = inventoryById.get(String(r.inventoryItem));
        return {
          reservationId: r.reservationId,
          status: r.status,
          quantity: r.quantity,
          expiresAt: r.expiresAt,
          product: r.product?.title,
          dealer: r.dealer?.businessName || r.dealer?.name,
          fulfillmentNode: {
            name: r.fulfillmentNode?.name,
            isActive: r.fulfillmentNode?.isActive,
            serviceRadiusKm: r.fulfillmentNode?.serviceRadiusKm,
            coordinates: r.fulfillmentNode?.location?.coordinates || null,
          },
          inventory: inv
            ? {
                onHand: inv.onHand, reserved: inv.reserved, damaged: inv.damaged, blocked: inv.blocked,
                available: Math.max(0, inv.onHand - inv.reserved - inv.damaged - inv.blocked),
                isActive: inv.isActive,
              }
            : null,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export default { postValidateCheckout, postReleaseCheckout, postCreateOrderFromCheckout, getCheckoutDebug };