import mongoose from 'mongoose';
import Cart from '../../models/Cart.js';
import Product from '../../models/Product.js';
import CheckoutSession from '../../models/CheckoutSession.js';
import { planCartFulfillment } from '../fulfillment/fulfillmentPlanner.js';
import { pickMostUsefulReason } from '../fulfillment/fulfillmentService.js';
import {
  reserveInventory,
  releaseReservation,
  releaseReservationsForUser,
  RESERVATION_TTL_MINUTES,
} from '../inventory/reservationService.js';

/**
 * checkoutValidationService — Phase 4
 * ─────────────────────────────────────────────────────────────────────────
 * "Make the fulfillment plan safe for checkout." Reuses the Phase 3
 * planner as-is (no duplicated eligibility/scoring logic — §28) and adds
 * exactly what checkout time needs on top of it: fresh-data revalidation,
 * atomic reservation, and a session to hand off to a future order-
 * creation phase.
 *
 * Never trusts price/dealer/inventory/node ids from the frontend (§7) —
 * the cart is loaded from MongoDB and the plan is recomputed from
 * scratch against current data every single call.
 */

const log = (event, payload = {}) => {
  console.log(JSON.stringify({ event, ...payload, at: new Date().toISOString() }));
};

// Reason codes the Phase 3 planner can produce, mapped to the checkout-
// level codes the spec asks for (§17). Anything not explicitly mapped
// falls back to NO_NEARBY_FULFILLMENT.
const REASON_TO_CHECKOUT_CODE = {
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  NO_AVAILABLE_STOCK: 'INSUFFICIENT_STOCK',
  OUTSIDE_SERVICE_RADIUS: 'OUTSIDE_SERVICE_RADIUS',
  INACTIVE_NODE: 'NO_NEARBY_FULFILLMENT',
  INACTIVE_INVENTORY: 'INSUFFICIENT_STOCK',
  NODE_NOT_IN_OFFER: 'NODE_NOT_IN_OFFER',
  NO_ACTIVE_OFFER: 'NO_NEARBY_FULFILLMENT',
  NO_COORDINATES: 'NO_NEARBY_FULFILLMENT',
  NO_FULFILLMENT_NODE: 'NO_NEARBY_FULFILLMENT',
};

/**
 * Runs `fn(session)` inside a real MongoDB transaction when the deployment
 * supports one (a replica set / mongos), and transparently falls back to
 * running `fn(null)` without a session otherwise (a bare standalone
 * `mongod`, common in local dev, does not support transactions at all).
 * Either way, correctness against overselling is preserved because each
 * individual reservation is already atomic on its own (see
 * reservationService.atomicReserve) — the transaction is a best-effort
 * "all or nothing" wrapper on top of that, not the only line of defense.
 */
const withOptionalTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    const unsupported =
      /Transaction numbers|IllegalOperation|Transactions are not supported|replica set/i.test(err.message || '');
    if (!unsupported) throw err;
    // No replica set available — fall back to a non-transactional run.
    // (Each atomic $expr-guarded update below still individually
    // prevents overselling; we lose only the "all-or-nothing" wrapper,
    // which we compensate for with explicit manual rollback below.)
    return fn(null);
  } finally {
    await session.endSession();
  }
};

/**
 * Product-level gate before we even bother with fulfillment. This
 * codebase has no dedicated `Product.isActive` flag (Phase 1 kept the
 * legacy schema untouched); `availableInIndia` is the closest existing
 * signal for "not purchasable right now", so we use that rather than
 * inventing a new field.
 */
const isProductPurchasable = (product) => Boolean(product) && product.availableInIndia !== false;

export const validateCheckout = async ({ userId, latitude, longitude }) => {
  log('CHECKOUT_VALIDATION_STARTED', { userId, latitude, longitude });

  if (latitude == null || longitude == null || Number.isNaN(Number(latitude)) || Number.isNaN(Number(longitude))) {
    return { success: false, code: 'INVALID_LOCATION', message: 'Valid latitude and longitude are required.' };
  }

  // ── Step 1 — load cart ─────────────────────────────────────────────
  const cart = await Cart.findOne({ user: userId }).populate('items.product').lean();
  if (!cart || !cart.items?.length) {
    return { success: false, code: 'EMPTY_CART', message: 'Cart is empty.' };
  }

  // ── Step 2 — validate products ──────────────────────────────────────
  const unavailableProducts = cart.items.filter((i) => !isProductPurchasable(i.product));
  if (unavailableProducts.length) {
    return {
      success: false,
      code: 'PRODUCT_UNAVAILABLE',
      message: 'One or more products are no longer available.',
      unavailableProductIds: unavailableProducts.map((i) => String(i.product?._id || i.product)),
    };
  }

  // ── Step 3 — recalculate fulfillment fresh (Phase 3 planner, reused
  //    as-is — this IS the "latest inventory validation" the spec wants;
  //    it re-queries FulfillmentNode/InventoryItem/DealerOffer live and
  //    already encodes node-active / service-radius / offer-active /
  //    node-in-offer / stock rules — §4/§18) ─────────────────────────
  const cartItems = cart.items.map((i) => ({ productId: i.product._id, quantity: i.quantity }));
  const plan = await planCartFulfillment({ cartItems, latitude: Number(latitude), longitude: Number(longitude) });

  log('FULFILLMENT_RECALCULATED', {
    userId, isFulfillable: plan.isFulfillable, groupCount: plan.groups.length,
    unfulfilledCount: plan.unfulfilledItems.length,
  });

  if (!plan.isFulfillable) {
    const code = REASON_TO_CHECKOUT_CODE[pickMostUsefulReason(plan.unfulfilledItems.map((u) => u.reason))] || 'NO_NEARBY_FULFILLMENT';
    log('CHECKOUT_VALIDATION_FAILED', { userId, code, unfulfilledItems: plan.unfulfilledItems });
    return {
      success: false,
      code,
      message: CHECKOUT_ERROR_MESSAGES[code],
      unfulfilledItems: plan.unfulfilledItems,
    };
  }

  // ── Steps 4/5 are already enforced inside the planner's per-candidate
  //    `diagnose()` (node active + radius + offer active + node-in-offer)
  //    — nothing here duplicates that logic (§28/§30.5). ───────────────

  // ── Supersede any previous still-open session for this user (§12) —
  //    never let two active sessions hold overlapping reservations for
  //    the same cart. ───────────────────────────────────────────────
  const existing = await CheckoutSession.findOne({ user: userId, status: 'ACTIVE' });
  if (existing) {
    await releaseReservationsForUser(userId);
    existing.status = existing.expiresAt <= new Date() ? 'EXPIRED' : 'CANCELLED';
    await existing.save();
  }

  // ── Step 9 — atomic reservation, one call per (product, node) line.
  //    All-or-nothing: any failure rolls back everything reserved so far
  //    in this attempt (§9/§21). ───────────────────────────────────────
  const flatLines = plan.groups.flatMap((g) =>
    g.items.map((item) => ({
      inventoryItemId: item.inventoryId,
      productId: item.productId,
      dealerId: g.dealerId,
      fulfillmentNodeId: g.fulfillmentNodeId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    }))
  );

  const reservationResult = await withOptionalTransaction(async (session) => {
    const created = [];
    for (const line of flatLines) {
      const result = await reserveInventory({
        userId,
        inventoryItemId: line.inventoryItemId,
        productId: line.productId,
        dealerId: line.dealerId,
        fulfillmentNodeId: line.fulfillmentNodeId,
        quantity: line.quantity,
        session,
      });
      if (!result.success) {
        log('INVENTORY_RESERVATION_FAILED', { userId, productId: line.productId, code: result.code });
        // Roll back everything reserved so far in this attempt.
        for (const r of created) await releaseReservation({ reservationId: r.reservation._id, session });
        return { success: false, code: result.code };
      }
      created.push(result);
      log('INVENTORY_RESERVATION_CREATED', {
        userId, productId: line.productId, quantity: line.quantity, reservationId: result.reservation.reservationId,
      });
    }
    return { success: true, reservations: created.map((r) => r.reservation) };
  });

  if (!reservationResult.success) {
    return {
      success: false,
      code: 'RESERVATION_FAILED',
      message: CHECKOUT_ERROR_MESSAGES.RESERVATION_FAILED,
    };
  }

  // ── Build + persist the checkout session ────────────────────────────
  const subtotal = flatLines.reduce((sum, l) => sum + (l.unitPrice || 0) * l.quantity, 0);
  const itemCount = flatLines.reduce((sum, l) => sum + l.quantity, 0);
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);

  const checkoutSession = await CheckoutSession.create({
    user: userId,
    status: 'ACTIVE',
    latitude: Number(latitude),
    longitude: Number(longitude),
    reservations: reservationResult.reservations.map((r) => r._id),
    fulfillmentPlanSnapshot: plan,
    summary: { subtotal, itemCount },
    expiresAt,
  });

  // Back-fill checkoutSession on each reservation for the release/debug
  // endpoints to look up by session.
  await mongoose.model('InventoryReservation').updateMany(
    { _id: { $in: reservationResult.reservations.map((r) => r._id) } },
    { $set: { checkoutSession: checkoutSession._id } }
  );

  log('CHECKOUT_SESSION_CREATED', { userId, sessionId: checkoutSession.sessionId, itemCount, subtotal });

  return {
    success: true,
    checkoutSessionId: checkoutSession.sessionId,
    expiresAt: checkoutSession.expiresAt,
    fulfillmentPlan: { groups: plan.groups },
    summary: { subtotal, itemCount },
  };
};

export const CHECKOUT_ERROR_MESSAGES = {
  INSUFFICIENT_STOCK: 'Some products are no longer available in the required quantity.',
  NO_NEARBY_FULFILLMENT: "We couldn't find a nearby fulfillment location for all items.",
  OUTSIDE_SERVICE_RADIUS: 'Some products cannot currently be delivered to your location.',
  NODE_NOT_IN_OFFER: 'Some products are no longer available from their seller at this location.',
  PRODUCT_UNAVAILABLE: 'One or more products are no longer available.',
  EMPTY_CART: 'Cart is empty.',
  CHECKOUT_SESSION_EXPIRED: 'Your checkout session has expired. Please try again.',
  RESERVATION_FAILED: 'Inventory changed while you were checking out. Please review your cart and try again.',
  INVALID_LOCATION: 'Valid latitude and longitude are required.',
};

export default { validateCheckout, CHECKOUT_ERROR_MESSAGES };