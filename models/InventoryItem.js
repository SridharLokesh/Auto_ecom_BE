import mongoose from 'mongoose';

/**
 * InventoryItem
 * ─────────────────────────────────────────────────────────────────────────
 * The actual physical stock owned by a dealer at one specific fulfillment
 * location, for one product.
 *
 *   Product  ×  Dealer  ×  FulfillmentNode   →   one InventoryItem
 *
 * available is NOT stored — it is always derived:
 *
 *   available = onHand - reserved - damaged - blocked
 *
 * so inconsistent states (e.g. onHand=100, reserved=10, available=95)
 * are impossible by construction.
 *
 * `reserved` exists only to make the schema future-compatible with
 * Phase 2 reservation. NO reservation logic is implemented in Phase 1.
 */
const inventoryItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    dealer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    fulfillmentNode: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FulfillmentNode',
      required: true,
    },

    sku: { type: String, required: true, trim: true },
    externalSku: { type: String, default: null },

    onHand:  { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    damaged: { type: Number, default: 0, min: 0 },
    blocked: { type: Number, default: 0, min: 0 },

    lastUpdatedAt: { type: Date, default: Date.now },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

/* ── derived available stock ─────────────────────────────────────────── */
inventoryItemSchema.virtual('available').get(function () {
  return Math.max(
    0,
    (this.onHand || 0) -
      (this.reserved || 0) -
      (this.damaged || 0) -
      (this.blocked || 0)
  );
});

inventoryItemSchema.set('toJSON', { virtuals: true });
inventoryItemSchema.set('toObject', { virtuals: true });

/* ── cross-field validation ──────────────────────────────────────────── */
// reserved + damaged + blocked must never exceed onHand.
inventoryItemSchema.pre('validate', function (next) {
  const sum =
    (this.reserved || 0) + (this.damaged || 0) + (this.blocked || 0);
  if (sum > (this.onHand || 0)) {
    const err = new Error(
      'Reserved + damaged + blocked cannot exceed on hand stock'
    );
    err.name = 'ValidationError';
    return next(err);
  }
  next();
});

/* ── indexes ─────────────────────────────────────────────────────────── */
// One InventoryItem per (product, dealer, node).
inventoryItemSchema.index(
  { product: 1, dealer: 1, fulfillmentNode: 1 },
  { unique: true }
);
// Get-all-for-dealer / all-for-node queries.
inventoryItemSchema.index({ dealer: 1, fulfillmentNode: 1 });
// SKU lookups (migration + search).
inventoryItemSchema.index({ sku: 1 });

inventoryItemSchema.index({ product: 1, fulfillmentNode: 1 });
inventoryItemSchema.index({ product: 1, dealer: 1 });

// avoiding an extra in-memory filter pass on large result sets.
inventoryItemSchema.index({ product: 1, fulfillmentNode: 1, isActive: 1 });

const InventoryItem = mongoose.model('InventoryItem', inventoryItemSchema);
export default InventoryItem;