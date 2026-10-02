import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema({
  product:  { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  dealer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  title:    String,
  image:    String,
  price:    Number,
  quantity: Number,
  color:    String,
  dealerPackedAt: Date,
  // Phase 5 — additional snapshot fields for orders created via the
  // checkout-session flow (createOrderFromCheckout). Optional/nullable so
  // existing orders (and the legacy placeOrder path) are unaffected.
  dealerOffer:     { type: mongoose.Schema.Types.ObjectId, ref: 'DealerOffer', default: null },
  inventoryItem:   { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
  fulfillmentNode: { type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentNode', default: null },
  sku:             { type: String, default: '' },
  lineTotal:       { type: Number, default: null },
});

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orderItems:  [orderItemSchema],
    shippingAddress: {
      label:   String,
      street:  String,
      city:    String,
      state:   String,
      pincode: String,
      country: { type: String, default: 'India' },
    },
    paymentMethod: { type: String, default: 'COD' },
    itemsPrice:    Number,
    taxPrice:      { type: Number, default: 0 },
    shippingPrice: { type: Number, default: 0 },
    totalPrice:    Number,
    isPaid:        { type: Boolean, default: false },
    isDelivered:   { type: Boolean, default: false },
    orderStatus: {
      type:    String,
      enum:    ['Placed', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Cancelled', 'Returned', 'Refunded'],
      default: 'Placed',
    },
    trackingNumber: String,
    deliveredAt:    Date,
    invoiceNumber:  { type: String, default: '' },
    notes:          { type: String, default: '' },

    // Phase 5 — additive fields for orders created via the checkout-session
    // flow. All optional so existing orders and the legacy placeOrder path
    // (which never set these) remain perfectly valid documents.
    orderNumber:      { type: String, default: null }, // unique+sparse index below
    checkoutSession:  { type: mongoose.Schema.Types.ObjectId, ref: 'CheckoutSession', default: null },
    fulfillmentGroups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FulfillmentGroup' }],
    // Separate from the existing `orderStatus` enum (which stays as-is and
    // drives all existing dealer/admin/customer UI) — this tracks the
    // per-fulfillment-group rollup introduced in Phase 5.
    fulfillmentStatus: {
      type: String,
      enum: ['pending', 'assigned', 'processing', 'partially_shipped', 'shipped', 'partially_delivered', 'delivered', 'cancelled'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

orderSchema.index({ orderNumber: 1 }, { unique: true, sparse: true });

// Auto-generate invoice number on save
orderSchema.pre('save', function (next) {
  if (!this.invoiceNumber) {
    const ts   = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.invoiceNumber = `TVS-INV-${ts}-${rand}`;
  }
  next();
});

const Order = mongoose.model('Order', orderSchema);
export default Order;