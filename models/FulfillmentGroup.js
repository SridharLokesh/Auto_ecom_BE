import mongoose from 'mongoose';

/**
 * FulfillmentGroup — Phase 5
 * ─────────────────────────────────────────────────────────────────────────
 * One physical node's share of a customer's order. A single Order can
 * have multiple FulfillmentGroups (one per fulfillment node the cart's
 * items were split across) — the customer sees ONE order; internally it
 * may ship as several independent shipments (§4).
 */
const fulfillmentGroupItemSchema = new mongoose.Schema(
  {
    orderItemId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    product:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    quantity:      { type: Number, required: true, min: 1 },
    unitPrice:     { type: Number, required: true, min: 0 },
    lineTotal:     { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const fulfillmentGroupSchema = new mongoose.Schema(
  {
    order:           { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    fulfillmentNode: { type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentNode', required: true },
    dealer:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    items: [fulfillmentGroupItemSchema],

    subtotal:    { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['pending', 'confirmed', 'picking', 'processing', 'packed', 'ready_for_dispatch', 'dispatched', 'in_transit', 'delivered', 'cancelled', 'failed'],
      default: 'confirmed', // order creation already validated + reserved stock — a group starts pre-confirmed
    },

    trackingNumber: { type: String, default: '' },

    // Phase 6 — picking/packing/dispatch operational metadata. All
    // optional so existing (Phase 5) fulfillment groups remain valid.
    pickingStartedAt: Date,
    pickedAt:         Date,
    pickedBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    packedBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    packageCount:      { type: Number, default: null },
    packageWeightKg:   { type: Number, default: null },
    packageDimensions: { type: String, default: '' }, // e.g. "30x20x15 cm" — free text for now
    packagingNotes:    { type: String, default: '' },

    readyForDispatchAt: Date,

    deliveryAssignment: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryAssignment', default: null },

    assignedAt:  Date,
    packedAt:    Date,
    shippedAt:   Date,
    deliveredAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

fulfillmentGroupSchema.index({ order: 1 });
fulfillmentGroupSchema.index({ dealer: 1, status: 1 });
fulfillmentGroupSchema.index({ fulfillmentNode: 1 });

const FulfillmentGroup = mongoose.model('FulfillmentGroup', fulfillmentGroupSchema);
export default FulfillmentGroup;