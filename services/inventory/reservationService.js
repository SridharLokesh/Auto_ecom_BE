import InventoryItem from '../../models/InventoryItem.js';
import InventoryReservation from '../../models/InventoryReservation.js';

/**
 * reservationService — Phase 4
 * ─────────────────────────────────────────────────────────────────────────
 * Atomic stock reservation. `InventoryItem.onHand` is NEVER touched here
 * (§2/§19) — only `reserved` moves, and only through a single atomic
 * `findOneAndUpdate` whose filter re-checks availability server-side, so
 * the check-then-write race the spec warns about (§3) is structurally
 * impossible: two concurrent requests both compute `available` from the
 * same stale read, MongoDB itself evaluates the `$expr` filter against
 * the current document for each request in turn, so only as many
 * reservations succeed as there is real stock for.
 */

export const RESERVATION_TTL_MINUTES = Number(process.env.RESERVATION_TTL_MINUTES || 10);

const availableExpr = {
  $subtract: ['$onHand', { $add: ['$reserved', '$damaged', '$blocked'] }],
};

/**
 * The one atomic primitive everything else is built on: increase
 * `reserved` by `quantity` IF AND ONLY IF the document, evaluated at
 * update time (not at some earlier read time), still has enough
 * available stock. Returns the updated document, or null if the
 * condition didn't hold (insufficient stock / inactive / not found).
 */
const atomicReserve = ({ inventoryItemId, quantity, session }) =>
  InventoryItem.findOneAndUpdate(
    {
      _id: inventoryItemId,
      isActive: true,
      $expr: { $gte: [availableExpr, quantity] },
    },
    { $inc: { reserved: quantity } },
    { new: true, session }
  );

/** Symmetric atomic release primitive — never lets `reserved` go negative. */
const atomicRelease = ({ inventoryItemId, quantity, session }) =>
  InventoryItem.findOneAndUpdate(
    {
      _id: inventoryItemId,
      reserved: { $gte: quantity },
    },
    { $inc: { reserved: -quantity } },
    { new: true, session }
  );

/**
 * Reserve `quantity` units of one InventoryItem for one user, atomically,
 * and record an InventoryReservation. If the InventoryReservation write
 * fails after the InventoryItem update succeeded, the reservation is
 * rolled back immediately (§4.7) — no window where stock looks reserved
 * but no record explains why.
 */
export const reserveInventory = async ({
  userId,
  inventoryItemId,
  productId,
  dealerId,
  fulfillmentNodeId,
  quantity,
  checkoutSessionId = null,
  session = null,
}) => {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    return { success: false, code: 'INVALID_QUANTITY' };
  }

  const updated = await atomicReserve({ inventoryItemId, quantity: qty, session });
  if (!updated) {
    return { success: false, code: 'INSUFFICIENT_STOCK' };
  }

  try {
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);
    const [reservation] = await InventoryReservation.create(
      [{
        user: userId,
        inventoryItem: inventoryItemId,
        product: productId,
        dealer: dealerId,
        fulfillmentNode: fulfillmentNodeId,
        quantity: qty,
        status: 'ACTIVE',
        checkoutSession: checkoutSessionId,
        expiresAt,
      }],
      { session }
    );
    return { success: true, reservation, inventoryItem: updated };
  } catch (err) {
    // Roll back the increment we just made — the reservation record
    // failed to persist, so the stock hold must not persist either.
    await atomicRelease({ inventoryItemId, quantity: qty, session });
    return { success: false, code: 'RESERVATION_WRITE_FAILED', error: err.message };
  }
};

/**
 * Release one reservation. Idempotent: the ACTIVE→RELEASED flip itself is
 * the atomic guard — only the caller that successfully flips the status
 * actually decrements `reserved` (§6/§20), so calling this twice (or
 * concurrently with expiry sweep) can never double-decrement (Test 6).
 */
export const releaseReservation = async ({ reservationId, session = null, finalStatus = 'RELEASED' }) => {
  const reservation = await InventoryReservation.findOneAndUpdate(
    { _id: reservationId, status: 'ACTIVE' },
    { $set: { status: finalStatus } },
    { new: false, session } // old doc — we need its quantity/inventoryItem before the flip
  );
  if (!reservation) return { released: false, reason: 'NOT_ACTIVE_OR_NOT_FOUND' };

  await atomicRelease({ inventoryItemId: reservation.inventoryItem, quantity: reservation.quantity, session });
  return { released: true, reservation };
};

/** Release every ACTIVE reservation belonging to a user (e.g. cart reset). */
export const releaseReservationsForUser = async (userId, { session = null } = {}) => {
  const active = await InventoryReservation.find({ user: userId, status: 'ACTIVE' }).select('_id').lean();
  const results = [];
  for (const { _id } of active) results.push(await releaseReservation({ reservationId: _id, session }));
  return results;
};

/** Release every ACTIVE reservation tied to a specific checkout session. */
export const releaseReservationsForSession = async (checkoutSessionId, { session = null } = {}) => {
  const active = await InventoryReservation.find({ checkoutSession: checkoutSessionId, status: 'ACTIVE' })
    .select('_id')
    .lean();
  const results = [];
  for (const { _id } of active) results.push(await releaseReservation({ reservationId: _id, session }));
  return results;
};

/**
 * Sweep ACTIVE reservations whose expiresAt has passed and release them.
 * MUST be called explicitly rather than relying solely on a Mongo TTL
 * index (§1 — TTL background deletion is asynchronous and would let
 * `reserved` stay inflated for longer than acceptable). Idempotent —
 * safe to run on an interval.
 */
export const releaseExpiredReservations = async () => {
  // Phase 6 — once a reservation is linked to an order it's held for the
  // whole fulfillment lifecycle, not the short checkout TTL; only
  // un-ordered (still-in-checkout) reservations can expire this way.
  const expired = await InventoryReservation.find({ status: 'ACTIVE', expiresAt: { $lte: new Date() }, order: null })
    .select('_id')
    .lean();

  let released = 0;
  for (const { _id } of expired) {
    const result = await releaseReservation({ reservationId: _id, finalStatus: 'EXPIRED' });
    if (result.released) released += 1;
  }
  return { checked: expired.length, released };
};

/** Marks a reservation CONSUMED — for a future order-creation phase to call once the order is actually placed. Does not touch `reserved`/`onHand` (that belongs to the order-creation phase's own logic). */
export const consumeReservation = async ({ reservationId, session = null }) =>
  InventoryReservation.findOneAndUpdate(
    { _id: reservationId, status: 'ACTIVE' },
    { $set: { status: 'CONSUMED' } },
    { new: true, session }
  );

export const getActiveReservations = (userId) =>
  InventoryReservation.find({ user: userId, status: 'ACTIVE' }).lean();

/**
 * Commit a reservation — Phase 5 (§12/§24). Converts a temporary hold
 * into permanently-consumed stock: `onHand` and `reserved` both decrease
 * by the reserved quantity (never touched independently — §12), and the
 * reservation flips ACTIVE → CONSUMED. Idempotent via the same
 * ACTIVE→CONSUMED atomic guard used by `releaseReservation` — only the
 * caller that wins the flip actually decrements inventory.
 */
export const commitReservation = async ({ reservationId, session = null }) => {
  const reservation = await InventoryReservation.findOneAndUpdate(
    { _id: reservationId, status: 'ACTIVE' },
    { $set: { status: 'CONSUMED' } },
    { new: false, session }
  );
  if (!reservation) return { committed: false, reason: 'NOT_ACTIVE_OR_NOT_FOUND' };

  const updated = await InventoryItem.findOneAndUpdate(
    {
      _id: reservation.inventoryItem,
      onHand: { $gte: reservation.quantity },
      reserved: { $gte: reservation.quantity },
    },
    { $inc: { onHand: -reservation.quantity, reserved: -reservation.quantity } },
    { new: true, session }
  );
  // Even in the pathological case where onHand/reserved were already
  // inconsistent, the reservation has already been marked CONSUMED —
  // never leave it ACTIVE while stock silently fails to commit.
  return { committed: true, reservation, inventoryItem: updated };
};

export default {
  RESERVATION_TTL_MINUTES,
  reserveInventory,
  releaseReservation,
  releaseReservationsForUser,
  releaseReservationsForSession,
  releaseExpiredReservations,
  consumeReservation,
  commitReservation,
  getActiveReservations,
};