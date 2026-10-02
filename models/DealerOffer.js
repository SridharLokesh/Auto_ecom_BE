import mongoose from 'mongoose';

/**
 * DealerOffer
 * ─────────────────────────────────────────────────────────────────────────
 * Represents "which dealer is selling this Product and at what commercial
 * terms". The catalogue Product stays dealer-agnostic; every dealer that
 * sells the same Product gets their own DealerOffer (own SKU + own price).
 *
 *   Product ──┬── DealerOffer → Dealer A
 *             ├── DealerOffer → Dealer B
 *             └── DealerOffer → Dealer C
 *
 * Uniqueness: one (product, dealer) pair → one offer. Prevents accidental
 * duplicate offers created by the same dealer.
 */
const dealerOfferSchema = new mongoose.Schema(
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

    sku: {
      type: String,
      required: true,
      trim: true,
    },

    externalSku: { type: String, default: null },

    mrp: {
      type: Number,
      required: true,
      min: 0,
    },

    sellingPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    isActive: { type: Boolean, default: true },

    // Nodes where this dealer physically holds inventory for this product.
    fulfillmentNodes: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentNode' },
    ],
  },
  { timestamps: true }
);

// A dealer must not have more than one offer for the same product.
dealerOfferSchema.index({ product: 1, dealer: 1 }, { unique: true });
// Offer lookups by SKU (used by migration + product sync).
dealerOfferSchema.index({ sku: 1 });
// Phase 3 §27 — candidate lookup filtered directly by active status.
dealerOfferSchema.index({ product: 1, dealer: 1, isActive: 1 });

const DealerOffer = mongoose.model('DealerOffer', dealerOfferSchema);
export default DealerOffer;