import mongoose from 'mongoose';
import Order from '../../models/Order.js';
import FulfillmentGroup from '../../models/FulfillmentGroup.js';
import CheckoutSession from '../../models/CheckoutSession.js';
import InventoryReservation from '../../models/InventoryReservation.js';
import DealerOffer from '../../models/DealerOffer.js';
import Cart from '../../models/Cart.js';
import Notification from '../../models/Notification.js';
import { groupLinesByFulfillmentNode } from './fulfillmentGroupService.js';
import { generateOrderNumber } from './orderNumberService.js';
import { calculateDeliveryFee } from './deliveryFeeService.js';
import { updateOrderFulfillmentStatus } from './orderStatusService.js';

/**
 * orderService — Phase 5
 * ─────────────────────────────────────────────────────────────────────────
 * `createOrderFromCheckout` is the ONLY way an order gets created from a
 * validated/reserved checkout session. It:
 *   - never trusts price/quantity/dealer/inventory ids from the client
 *     (§26/§27) — everything is re-derived from the session's live
 *     ACTIVE InventoryReservations, which are themselves the output of
 *     Phase 4's atomic, revalidated reservation step;
 *   - is idempotent (§25) — a session that already has an order just
 *     returns that order again, never creates a second one;
 *   - groups order items into FulfillmentGroups by node (§13/§14);
 *   - Phase 6 correction: does NOT commit inventory here. `onHand` stays
 *     untouched at order-creation time — only `InventoryItem.reserved`
 *     is held (already true since Phase 4). The reservation is instead
 *     LINKED to this order/group and stays ACTIVE through the whole
 *     picking/packing/dispatch lifecycle; actual `onHand` consumption
 *     happens exactly once, atomically, when a FulfillmentGroup is
 *     marked delivered (see fulfillmentOrchestrationService.markDelivered).
 *   - wraps everything in a best-effort transaction with a graceful
 *     fallback for standalone (non-replica-set) MongoDB, exactly like
 *     Phase 4's checkout flow (§11/§21).
 */

const log = (event, payload = {}) => console.log(JSON.stringify({ event, ...payload, at: new Date().toISOString() }));

// Duplicated (intentionally, in miniature) from checkoutValidationService's
// withOptionalTransaction rather than importing across phase boundaries —
// keeps this phase's code self-contained and avoids touching working
// Phase 4 code unnecessarily (§42).
const withOptionalTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } catch (err) {
    const unsupported = /Transaction numbers|IllegalOperation|Transactions are not supported|replica set/i.test(err.message || '');
    if (!unsupported) throw err;
    return fn(null);
  } finally {
    await session.endSession();
  }
};

export const createOrderFromCheckout = async ({ checkoutSessionId, userId, shippingAddress, paymentMethod = 'COD' }) => {
  log('ORDER_CREATION_STARTED', { userId, checkoutSessionId });

  const checkoutSession = await CheckoutSession.findOne({ sessionId: checkoutSessionId });
  if (!checkoutSession) return { success: false, code: 'CHECKOUT_SESSION_NOT_FOUND' };
  if (String(checkoutSession.user) !== String(userId)) return { success: false, code: 'FORBIDDEN' };

  // ── Idempotency (§25) — a session that already produced an order just
  //    hands that order back; never creates a second one. ──────────────
  if (checkoutSession.order) {
    const existing = await Order.findById(checkoutSession.order)
      .populate('fulfillmentGroups')
      .populate('orderItems.product', 'title image');
    if (existing) return { success: true, order: existing, idempotent: true };
  }

  if (checkoutSession.status === 'CANCELLED') return { success: false, code: 'CHECKOUT_SESSION_CANCELLED' };
  if (checkoutSession.status === 'EXPIRED' || checkoutSession.expiresAt <= new Date()) {
    return { success: false, code: 'CHECKOUT_SESSION_EXPIRED' };
  }
  if (checkoutSession.status !== 'ACTIVE') return { success: false, code: 'CHECKOUT_SESSION_INVALID' };

  // ── Load the ACTIVE reservations this session made — these ARE the
  //    validated quantities/prices/nodes (§27); nothing here re-derives
  //    quantity from anywhere else, and nothing accepts a client-supplied
  //    quantity or price. ─────────────────────────────────────────────
  const reservations = await InventoryReservation.find({ checkoutSession: checkoutSession._id, status: 'ACTIVE' })
    .populate('product', 'title image')
    .populate('dealer', 'name businessName')
    .populate('fulfillmentNode', 'name');

  if (!reservations.length) return { success: false, code: 'RESERVATION_NOT_FOUND' };

  // Live price snapshot from DealerOffer at commit time — not from the
  // (possibly minutes-old) plan snapshot, and never from the client (§26).
  const offers = await DealerOffer.find({
    $or: reservations.map((r) => ({ product: r.product._id, dealer: r.dealer._id })),
  }).lean();
  const offerByKey = new Map(offers.map((o) => [`${o.product}:${o.dealer}`, o]));

  const lines = reservations.map((r) => {
    const offer = offerByKey.get(`${r.product._id}:${r.dealer._id}`);
    return {
      productId: r.product._id,
      productTitle: r.product.title,
      productImage: r.product.image,
      dealerId: r.dealer._id,
      dealerOfferId: offer?._id || null,
      sku: offer?.sku || '',
      fulfillmentNodeId: r.fulfillmentNode._id,
      nodeName: r.fulfillmentNode.name,
      inventoryItemId: r.inventoryItem,
      quantity: r.quantity,
      unitPrice: offer ? offer.sellingPrice : 0,
      reservationId: r._id,
    };
  });

  const groups = groupLinesByFulfillmentNode(lines);
  const orderItems = lines.map((l) => ({
    product: l.productId,
    dealer: l.dealerId,
    dealerOffer: l.dealerOfferId,
    inventoryItem: l.inventoryItemId,
    fulfillmentNode: l.fulfillmentNodeId,
    title: l.productTitle,
    image: l.productImage,
    sku: l.sku,
    price: l.unitPrice,
    quantity: l.quantity,
    lineTotal: l.unitPrice * l.quantity,
  }));

  const subtotal = orderItems.reduce((sum, i) => sum + i.lineTotal, 0);

  const result = await withOptionalTransaction(async (dbSession) => {
    const orderNumber = await generateOrderNumber();
    const deliveryFee = groups.reduce((sum, g) => sum + calculateDeliveryFee({ fulfillmentGroup: g, subtotal }), 0);
    const totalPrice = subtotal + deliveryFee;

    const [order] = await Order.create(
      [{
        user: userId,
        orderNumber,
        checkoutSession: checkoutSession._id,
        orderItems,
        shippingAddress,
        paymentMethod,
        itemsPrice: subtotal,
        shippingPrice: deliveryFee,
        totalPrice,
        orderStatus: 'Placed',
        fulfillmentStatus: 'pending',
      }],
      { session: dbSession }
    );

    const groupDocs = [];
    for (const g of groups) {
      const groupSubtotal = g.items.reduce((sum, i) => sum + i.lineTotal, 0);
      const groupDeliveryFee = calculateDeliveryFee({ fulfillmentGroup: g, subtotal: groupSubtotal });
      const [groupDoc] = await FulfillmentGroup.create(
        [{
          order: order._id,
          fulfillmentNode: g.fulfillmentNode,
          dealer: g.dealer,
          items: g.items,
          subtotal: groupSubtotal,
          deliveryFee: groupDeliveryFee,
          totalAmount: groupSubtotal + groupDeliveryFee,
          status: 'confirmed',
        }],
        { session: dbSession }
      );
      groupDocs.push(groupDoc);

      // ── Phase 6: link (not commit) the reservations belonging to this
      //    group. `onHand` is untouched here — the hold simply moves from
      //    "tied to a checkout session" to "tied to a placed order", and
      //    stays ACTIVE until the group is actually delivered. This also
      //    exempts them from the checkout-TTL expiry sweep (see
      //    reservationService.releaseExpiredReservations). ──────────────
      const linkResult = await InventoryReservation.updateMany(
        { _id: { $in: g.reservationIds }, status: 'ACTIVE' },
        { $set: { order: order._id, fulfillmentGroup: groupDoc._id } },
        { session: dbSession }
      );
      if (linkResult.matchedCount !== g.reservationIds.length) {
        // A reservation in this group is no longer ACTIVE (e.g. expired
        // in the narrow window between checkout and order creation) —
        // never leave an order with an unlinked/unheld line item.
        throw new Error('RESERVATION_LINK_FAILED');
      }
      log('INVENTORY_RESERVATION_LINKED_TO_ORDER', { userId, groupId: String(groupDoc._id), reservationCount: g.reservationIds.length });
    }

    order.fulfillmentGroups = groupDocs.map((g) => g._id);
    await order.save({ session: dbSession });

    checkoutSession.status = 'COMPLETED';
    checkoutSession.order = order._id;
    await checkoutSession.save({ session: dbSession });

    return { order, groupDocs };
  });

  // Clear the cart now that the order is placed (outside the transaction —
  // cosmetic, not a correctness concern if it partially fails).
  await Cart.findOneAndUpdate({ user: userId }, { items: [], totalPrice: 0 }).catch(() => {});

  await updateOrderFulfillmentStatus(result.order._id);

  // Notify dealers + buyer (reusing the existing Notification model/pattern).
  const dealerIds = [...new Set(result.groupDocs.map((g) => String(g.dealer)))];
  for (const dealerId of dealerIds) {
    await Notification.create({
      recipient: dealerId,
      recipientRole: 'dealer',
      type: 'new_order',
      title: 'New Order Received',
      message: `New order #${result.order.orderNumber} has fulfillment items for you`,
      link: '/dealer/orders',
      refOrder: result.order._id,
    }).catch(() => {});
  }
  await Notification.create({
    recipient: userId,
    recipientRole: 'user',
    type: 'order_status',
    title: 'Order Placed!',
    message: `Your order #${result.order.orderNumber} has been placed successfully`,
    link: '/profile?tab=orders',
    refOrder: result.order._id,
  }).catch(() => {});

  log('ORDER_CREATED', { userId, orderId: String(result.order._id), orderNumber: result.order.orderNumber, groupCount: result.groupDocs.length });

  const populated = await Order.findById(result.order._id)
    .populate('fulfillmentGroups')
    .populate('orderItems.product', 'title image');

  return { success: true, order: populated };
};

export default { createOrderFromCheckout };