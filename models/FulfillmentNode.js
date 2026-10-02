import mongoose from 'mongoose';

/**
 * FulfillmentNode
 * ─────────────────────────────────────────────────────────────────────────
 * A physical location where inventory exists and from which orders can
 * eventually be fulfilled.
 *
 * Phase 1:
 *   - Every dealer location starts as a DEALER node.
 *   - Coordinates are kept nullable — we NEVER fabricate geolocation.
 *     When real [longitude, latitude] is available it can be supplied.
 *
 * IMPORTANT: GeoJSON coordinates must ALWAYS be [longitude, latitude],
 * never [latitude, longitude].
 */
const fulfillmentNodeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    type: {
      type: String,
      enum: [
        'DEALER',
        'DARK_STORE',
        'WAREHOUSE',
        'REGIONAL_HUB',
        'PARTNER_STORE',
      ],
      default: 'DEALER',
    },

    // Owner dealer (null for platform-owned nodes such as warehouses/hubs)
    dealer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Coordinates are intentionally left with NO default. If we defaulted
    // to `{ type: 'Point', coordinates: null }`, every node created without
    // real coordinates would have a *present but invalid* GeoJSON value —
    // which the 2dsphere index below rejects at insert time (`Can't extract
    // geo keys ... Point must be an array or object, instead got type
    // null`). Leaving `location` entirely unset lets the sparse-like
    // behavior of a 2dsphere index simply skip that document until real
    // coordinates are supplied later.
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] },
    },

    address: {
      street:  { type: String, default: '' },
      city:    { type: String, default: '' },
      state:   { type: String, default: '' },
      country: { type: String, default: 'India' },
      pincode: { type: String, default: '' },
    },

    expressEnabled:    { type: Boolean, default: false },
    serviceRadiusKm:   { type: Number, default: 15, min: 0 },
    isActive:          { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Geo index — required for future near-by / radius queries (Phase 2+)
fulfillmentNodeSchema.index({ location: '2dsphere' });
// Fast lookup of a dealer's own nodes
fulfillmentNodeSchema.index({ dealer: 1, isActive: 1, type: 1 });

const FulfillmentNode = mongoose.model('FulfillmentNode', fulfillmentNodeSchema);
export default FulfillmentNode;