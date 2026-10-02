import mongoose from 'mongoose';

/**
 * FulfillmentEvent — Phase 6 (§14)
 * ─────────────────────────────────────────────────────────────────────────
 * Append-only audit trail for every fulfillment/order-lifecycle
 * transition. Never updated or overwritten after creation — a full
 * history is the point.
 */
const fulfillmentEventSchema = new mongoose.Schema(
  {
    order:            { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    fulfillmentGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentGroup', default: null },

    eventType: { type: String, required: true }, // e.g. ORDER_CREATED, PICKING_STARTED, DELIVERED, RESERVATION_CONSUMED...

    previousStatus: { type: String, default: null },
    newStatus:      { type: String, default: null },

    performedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    performedByRole: { type: String, default: 'system' }, // admin | dealer | user | system

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

fulfillmentEventSchema.index({ order: 1, createdAt: 1 });
fulfillmentEventSchema.index({ fulfillmentGroup: 1, createdAt: 1 });

const FulfillmentEvent = mongoose.model('FulfillmentEvent', fulfillmentEventSchema);
export default FulfillmentEvent;