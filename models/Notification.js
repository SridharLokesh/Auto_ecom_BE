import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    recipient:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipientRole: { type: String, enum: ['user', 'dealer', 'admin'], default: 'user' },

    type: {
      type: String,
      enum: [
        // User
        'order_status', 'best_deal', 'new_arrival', 'discount',
        // Dealer
        'new_order', 'return_request', 'low_stock',
        // Admin
        'dealer_request', 'complaint', 'new_user',
      ],
      required: true,
    },

    title:   { type: String, required: true },
    message: { type: String, required: true },
    link:    { type: String, default: '' },
    image:   { type: String, default: '' },

    isRead: { type: Boolean, default: false },

    // Reference data
    refOrder:   { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    refProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    refUser:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
