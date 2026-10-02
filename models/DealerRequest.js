import mongoose from 'mongoose';

const dealerRequestSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true },
    email:         { type: String, required: true },
    phone:         { type: String, required: true },
    businessName:  { type: String, required: true },
    businessLocation: { type: String, required: true },
    state:         { type: String, required: true },
    message:       { type: String, default: '' },
    status: {
      type:    String,
      enum:    ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    // Set after approval
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    adminNote: { type: String, default: '' },
  },
  { timestamps: true }
);

const DealerRequest = mongoose.model('DealerRequest', dealerRequestSchema);
export default DealerRequest;
