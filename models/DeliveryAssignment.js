import mongoose from 'mongoose';

/**
 * DeliveryAssignment — Phase 6 (§8)
 * ─────────────────────────────────────────────────────────────────────────
 * Internal delivery-assignment abstraction for one FulfillmentGroup.
 * `deliveryPartnerType` is deliberately a plain string (not hard-coded
 * logic anywhere) so a future Porter/Shadowfax/Delhivery/Shiprocket
 * integration can slot in later without touching the fulfillment
 * architecture — for now only 'INTERNAL' is actually used.
 */
const deliveryAssignmentSchema = new mongoose.Schema(
  {
    fulfillmentGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentGroup', required: true, unique: true },
    order:            { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
    fulfillmentNode:  { type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentNode', required: true },

    deliveryPartnerType: { type: String, default: 'INTERNAL' }, // INTERNAL | PORTER | SHADOWFAX | DELHIVERY | SHIPROCKET | ...
    deliveryPartnerId:   { type: String, default: '' },         // external reference id, once a real provider exists

    riderName:    { type: String, default: '' },
    riderPhone:   { type: String, default: '' },
    vehicleNumber:{ type: String, default: '' },

    trackingReference: { type: String, default: '' },

    status: {
      type: String,
      enum: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED'],
      default: 'ASSIGNED',
    },

    assignedAt:  { type: Date, default: Date.now },
    pickedUpAt:  Date,
    deliveredAt: Date,
  },
  { timestamps: true }
);

deliveryAssignmentSchema.index({ order: 1 });

const DeliveryAssignment = mongoose.model('DeliveryAssignment', deliveryAssignmentSchema);
export default DeliveryAssignment;