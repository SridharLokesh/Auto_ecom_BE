import FulfillmentGroup from '../../models/FulfillmentGroup.js';
import FulfillmentEvent from '../../models/FulfillmentEvent.js';
import DeliveryAssignment from '../../models/DeliveryAssignment.js';
import InventoryReservation from '../../models/InventoryReservation.js';
import { commitReservation, releaseReservation } from '../inventory/reservationService.js';
import { updateOrderFulfillmentStatus } from '../order/orderStatusService.js';

/**
 * fulfillmentOrchestrationService — Phase 6
 * ─────────────────────────────────────────────────────────────────────────
 * Every operational fulfillment transition (picking → packed → ready →
 * assigned → out-for-delivery → delivered) goes through `transition()`,
 * which is:
 *
 *   - ATOMIC: the status flip and its "must currently be in state X" guard
 *     are one `findOneAndUpdate` — two concurrent calls can never both
 *     succeed on the same group (§20/§22).
 *   - AUDITED: every successful transition writes an immutable
 *     FulfillmentEvent (§14) — never overwritten, never skipped.
 *   - THE ONLY WAY inventory actually leaves `onHand`: that happens
 *     exactly once, inside `markDelivered`, by calling the existing
 *     Phase 5 `commitReservation` (itself already idempotent via its own
 *     ACTIVE→CONSUMED atomic guard) — so even calling `delivered` twice
 *     concurrently cannot double-deduct stock (§11/§21, Test 6).
 */

const log = (event, payload = {}) => console.log(JSON.stringify({ event, ...payload, at: new Date().toISOString() }));

/** Explicit state machine — anything not listed here is not a legal transition. */
const TRANSITIONS = {
  confirm:           { from: ['pending'],              to: 'confirmed' },
  startPicking:      { from: ['confirmed'],           to: 'picking' },
  completePicking:   { from: ['picking'],              to: 'packed' },
  pack:              { from: ['picking', 'packed'],    to: 'packed' }, // allows recording package metadata even if completePicking already ran
  readyForDispatch:  { from: ['packed'],                to: 'ready_for_dispatch' },
  assignDelivery:    { from: ['ready_for_dispatch'],    to: 'dispatched' },   // "dispatched" == ASSIGNED
  outForDelivery:    { from: ['dispatched'],            to: 'in_transit' },  // "in_transit" == OUT_FOR_DELIVERY
  delivered:         { from: ['in_transit'],            to: 'delivered' },
  // Cancellation is only allowed early — packed-or-later requires explicit
  // manual/admin handling outside this standard path (§13).
  cancel:            { from: ['pending', 'confirmed', 'picking'], to: 'cancelled' },
};

export class FulfillmentError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/** Admin can touch any group; a dealer only their own. */
export const authorizeGroupAccess = (user, group) => {
  if (user.role === 'admin') return true;
  if (user.role === 'dealer' && String(group.dealer) === String(user._id)) return true;
  return false;
};

const atomicTransition = async ({ groupId, key, extraSet = {}, performedBy, performedByRole, metadata = {} }) => {
  const spec = TRANSITIONS[key];
  if (!spec) throw new FulfillmentError('INVALID_STATUS_TRANSITION', `Unknown transition ${key}`);

  // The `status: { $in: from }` guard IS the concurrency safety — only
  // one concurrent caller can match and flip a given group.
  const previous = await FulfillmentGroup.findOneAndUpdate(
    { _id: groupId, status: { $in: spec.from } },
    { $set: { status: spec.to, ...extraSet } },
    { new: false }
  );
  if (!previous) {
    const current = await FulfillmentGroup.findById(groupId).select('status');
    if (!current) throw new FulfillmentError('FULFILLMENT_GROUP_NOT_FOUND', 'Fulfillment group not found.');
    throw new FulfillmentError(
      'INVALID_STATUS_TRANSITION',
      `Cannot ${key} a group currently in status "${current.status}".`
    );
  }

  await FulfillmentEvent.create({
    order: previous.order,
    fulfillmentGroup: previous._id,
    eventType: key.replace(/([A-Z])/g, '_$1').toUpperCase(), // startPicking -> START_PICKING
    previousStatus: previous.status,
    newStatus: spec.to,
    performedBy: performedBy || null,
    performedByRole: performedByRole || 'system',
    metadata,
  });
  log(`fulfillment.${key}`, { groupId: String(groupId), from: previous.status, to: spec.to });

  const updated = await FulfillmentGroup.findById(groupId);
  await updateOrderFulfillmentStatus(updated.order);
  return updated;
};

/**
 * confirmGroup — groups created via order creation already start in
 * 'confirmed' (order creation implies fulfillment confirmation), so this
 * is idempotent: calling it on an already-confirmed group just returns
 * it as-is rather than erroring. It only performs a real transition for
 * a group that was created in 'pending' (a state this codebase doesn't
 * currently produce, but the transition exists for forward-compatibility
 * with any future flow that does).
 */
export const confirmGroup = async ({ groupId, actor }) => {
  const group = await FulfillmentGroup.findById(groupId);
  if (!group) throw new FulfillmentError('FULFILLMENT_GROUP_NOT_FOUND', 'Fulfillment group not found.');
  if (group.status === 'confirmed') return group;
  return atomicTransition({ groupId, key: 'confirm', performedBy: actor?._id, performedByRole: actor?.role });
};

export const startPicking = ({ groupId, actor }) =>
  atomicTransition({
    groupId, key: 'startPicking',
    extraSet: { pickingStartedAt: new Date() },
    performedBy: actor?._id, performedByRole: actor?.role,
  });

export const completePicking = ({ groupId, actor }) =>
  atomicTransition({
    groupId, key: 'completePicking',
    extraSet: { pickedAt: new Date(), pickedBy: actor?._id || null, packedAt: new Date() },
    performedBy: actor?._id, performedByRole: actor?.role,
  });

export const packGroup = ({ groupId, actor, packageCount, packageWeightKg, packageDimensions, packagingNotes }) =>
  atomicTransition({
    groupId, key: 'pack',
    extraSet: {
      packedAt: new Date(),
      packedBy: actor?._id || null,
      ...(packageCount != null ? { packageCount } : {}),
      ...(packageWeightKg != null ? { packageWeightKg } : {}),
      ...(packageDimensions ? { packageDimensions } : {}),
      ...(packagingNotes ? { packagingNotes } : {}),
    },
    performedBy: actor?._id, performedByRole: actor?.role,
    metadata: { packageCount, packageWeightKg, packageDimensions },
  });

export const readyForDispatch = async ({ groupId, actor }) => {
  const group = await FulfillmentGroup.findById(groupId);
  if (!group) throw new FulfillmentError('FULFILLMENT_GROUP_NOT_FOUND', 'Fulfillment group not found.');

  // §7 — re-validate reservation/quantity integrity before allowing
  // dispatch readiness: every item's reservation must still be ACTIVE
  // and for the exact quantity on the group.
  const reservations = await InventoryReservation.find({ fulfillmentGroup: group._id, status: 'ACTIVE' }).lean();
  const reservedQtyByProduct = new Map(reservations.map((r) => [String(r.product), r.quantity]));
  for (const item of group.items) {
    const qty = reservedQtyByProduct.get(String(item.product));
    if (qty === undefined || qty !== item.quantity) {
      throw new FulfillmentError('RESERVATION_NOT_FOUND', 'A reservation for this fulfillment group is missing or mismatched.');
    }
  }

  return atomicTransition({
    groupId, key: 'readyForDispatch',
    extraSet: { readyForDispatchAt: new Date() },
    performedBy: actor?._id, performedByRole: actor?.role,
  });
};

export const assignDelivery = async ({ groupId, actor, riderName, riderPhone, vehicleNumber, deliveryPartnerType }) => {
  const group = await atomicTransition({
    groupId, key: 'assignDelivery',
    extraSet: { assignedAt: new Date() },
    performedBy: actor?._id, performedByRole: actor?.role,
    metadata: { riderName, riderPhone, vehicleNumber },
  });

  // One assignment per group — upsert rather than duplicate (§8/§29 error code DELIVERY_ASSIGNMENT_EXISTS is
  // avoided entirely by making this idempotent instead of erroring).
  const assignment = await DeliveryAssignment.findOneAndUpdate(
    { fulfillmentGroup: group._id },
    {
      $setOnInsert: { fulfillmentGroup: group._id, order: group.order, fulfillmentNode: group.fulfillmentNode },
      $set: {
        deliveryPartnerType: deliveryPartnerType || 'INTERNAL',
        riderName: riderName || '', riderPhone: riderPhone || '', vehicleNumber: vehicleNumber || '',
        status: 'ASSIGNED', assignedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  await FulfillmentGroup.findByIdAndUpdate(group._id, { deliveryAssignment: assignment._id });
  return { group, assignment };
};

export const outForDelivery = async ({ groupId, actor }) => {
  const group = await atomicTransition({ groupId, key: 'outForDelivery', performedBy: actor?._id, performedByRole: actor?.role });
  await DeliveryAssignment.findOneAndUpdate(
    { fulfillmentGroup: group._id },
    { $set: { status: 'OUT_FOR_DELIVERY', pickedUpAt: new Date() } }
  );
  return group;
};

/**
 * markDelivered — the ONLY place `InventoryItem.onHand` is actually
 * reduced (§4/§11). Idempotent end-to-end: the group's own
 * `in_transit → delivered` atomic guard means a second concurrent/
 * duplicate call fails the transition itself with INVALID_STATUS_TRANSITION
 * before ever touching a reservation (Test 6).
 */
export const markDelivered = async ({ groupId, actor }) => {
  const group = await atomicTransition({
    groupId, key: 'delivered',
    extraSet: { deliveredAt: new Date() },
    performedBy: actor?._id, performedByRole: actor?.role,
  });

  const reservations = await InventoryReservation.find({ fulfillmentGroup: group._id, status: 'ACTIVE' }).select('_id').lean();
  for (const { _id } of reservations) {
    const result = await commitReservation({ reservationId: _id });
    if (result.committed) {
      await FulfillmentEvent.create({
        order: group.order, fulfillmentGroup: group._id, eventType: 'RESERVATION_CONSUMED',
        performedBy: actor?._id || null, performedByRole: actor?.role || 'system',
        metadata: { reservationId: String(_id) },
      });
    }
  }

  await DeliveryAssignment.findOneAndUpdate(
    { fulfillmentGroup: group._id },
    { $set: { status: 'DELIVERED', deliveredAt: new Date() } }
  );

  return group;
};

export const cancelGroup = async ({ groupId, actor, reason }) => {
  const group = await atomicTransition({
    groupId, key: 'cancel',
    extraSet: { cancelledAt: new Date() },
    performedBy: actor?._id, performedByRole: actor?.role,
    metadata: { reason },
  });

  // Release (not consume) the held stock — the order for this group
  // never actually happened from an inventory perspective.
  const reservations = await InventoryReservation.find({ fulfillmentGroup: group._id, status: 'ACTIVE' }).select('_id').lean();
  for (const { _id } of reservations) await releaseReservation({ reservationId: _id });

  return group;
};

export default {
  FulfillmentError,
  authorizeGroupAccess,
  confirmGroup,
  startPicking,
  completePicking,
  packGroup,
  readyForDispatch,
  assignDelivery,
  outForDelivery,
  markDelivered,
  cancelGroup,
};