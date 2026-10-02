import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * InventoryReservation — Phase 4
 * ─────────────────────────────────────────────────────────────────────────
 * A short-lived hold against an InventoryItem's stock, created at checkout
 * time so a customer's cart can't be sold out from under them between
 * "checkout started" and "order placed" (a later phase). References the
 * EXISTING InventoryItem — never a duplicate stock record (§19).
 *
 * `InventoryItem.reserved` is the source of truth for "how much is held
 * right now"; this document is the audit trail / release target for a
 * single hold. Increment/decrement of `reserved` always happens via an
 * atomic conditional update (see reservationService), never a plain
 * read-then-write.
 */
const inventoryReservationSchema = new mongoose.Schema(
  {
    reservationId: { type: String, required: true, unique: true, default: () => `RSV-${crypto.randomUUID()}` },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    product:        { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    dealer:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fulfillmentNode:{ type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentNode', required: true },

    quantity: { type: Number, required: true, min: 1 },

    status: {
      type: String,
      enum: ['ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED'],
      default: 'ACTIVE',
    },

    checkoutSession: { type: mongoose.Schema.Types.ObjectId, ref: 'CheckoutSession', default: null },
    // Phase 6 — once an order is placed, the reservation is linked here
    // and switches from "expires on a short checkout TTL" to "held until
    // the fulfillment group actually delivers" (see releaseExpiredReservations,
    // which now skips any reservation with `order` set).
    order:            { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    fulfillmentGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentGroup', default: null },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

inventoryReservationSchema.index({ inventoryItem: 1, status: 1 });
inventoryReservationSchema.index({ user: 1, status: 1 });
inventoryReservationSchema.index({ expiresAt: 1, status: 1 });
inventoryReservationSchema.index({ order: 1 });
inventoryReservationSchema.index({ fulfillmentGroup: 1 });
// `unique: true` on reservationId already creates an index; kept implicit.

const InventoryReservation = mongoose.model('InventoryReservation', inventoryReservationSchema);
export default InventoryReservation;