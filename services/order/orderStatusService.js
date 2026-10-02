import Order from '../../models/Order.js';
import FulfillmentGroup from '../../models/FulfillmentGroup.js';

/**
 * orderStatusService — Phase 5 (§22)
 * ─────────────────────────────────────────────────────────────────────────
 * Derives Order.fulfillmentStatus from the current state of its
 * FulfillmentGroups. Never set fulfillmentStatus by hand elsewhere —
 * always go through this so the rollup logic lives in exactly one place.
 *
 * Deliberately does NOT touch the existing `Order.orderStatus` enum
 * (Placed/Processing/Packed/Shipped/Delivered/...) — that field already
 * drives the existing dealer/admin/customer UI and email notifications;
 * `fulfillmentStatus` is an additive, more granular signal on top of it.
 */
const ACTIVE_STATUSES = ['picking', 'processing', 'packed', 'ready_for_dispatch', 'dispatched', 'in_transit'];

export const updateOrderFulfillmentStatus = async (orderId) => {
  const groups = await FulfillmentGroup.find({ order: orderId }).select('status').lean();
  if (!groups.length) return null;

  const statuses = groups.map((g) => g.status);
  const allSame = (s) => statuses.every((x) => x === s);
  const isTerminalNegative = (s) => s === 'cancelled' || s === 'failed';

  let fulfillmentStatus;
  if (statuses.every(isTerminalNegative)) {
    fulfillmentStatus = 'cancelled';
  } else if (allSame('delivered')) {
    fulfillmentStatus = 'delivered';
  } else if (statuses.some((s) => s === 'delivered')) {
    fulfillmentStatus = 'partially_delivered';
  } else if (statuses.some((s) => ['dispatched', 'in_transit'].includes(s))) {
    fulfillmentStatus = statuses.every((s) => ['dispatched', 'in_transit'].includes(s)) ? 'shipped' : 'partially_shipped';
  } else if (statuses.some((s) => ACTIVE_STATUSES.includes(s))) {
    fulfillmentStatus = 'processing';
  } else if (allSame('confirmed')) {
    fulfillmentStatus = 'assigned';
  } else {
    fulfillmentStatus = 'pending';
  }

  await Order.findByIdAndUpdate(orderId, { fulfillmentStatus });
  return fulfillmentStatus;
};

export default { updateOrderFulfillmentStatus };