import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * CheckoutSession — Phase 4
 * ─────────────────────────────────────────────────────────────────────────
 * A temporary handle representing "this user's cart has been revalidated
 * and its inventory reserved". A future phase (order creation) consumes
 * this session's reservations into a real Order. Nothing here creates an
 * Order or touches payment.
 */
const checkoutSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, default: () => `CHK-${crypto.randomUUID()}` },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    status: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'COMPLETED', 'CANCELLED'],
      default: 'ACTIVE',
    },

    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },

    reservations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'InventoryReservation' }],
    // Phase 5 — once an Order is created from this session, it's linked
    // here. A session with `order` already set can never create a second
    // order (idempotency/duplicate-order protection, §25).
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },

    // Snapshot of the plan used to create this session — handy for the
    // admin debug endpoint and for a future order-creation phase, purely
    // informational (not re-trusted for money math without revalidation).
    fulfillmentPlanSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    summary: {
      subtotal:  { type: Number, default: 0 },
      itemCount: { type: Number, default: 0 },
    },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

checkoutSessionSchema.index({ user: 1, status: 1 });
checkoutSessionSchema.index({ expiresAt: 1, status: 1 });

const CheckoutSession = mongoose.model('CheckoutSession', checkoutSessionSchema);
export default CheckoutSession;