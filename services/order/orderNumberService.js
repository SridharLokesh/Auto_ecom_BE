import Counter from '../../models/Counter.js';

/**
 * generateOrderNumber() → "TVS-YYYYMMDD-000001"
 * Server-side only (§9) — the frontend never supplies or influences this.
 * Uniqueness under concurrency comes from Counter's atomic $inc/upsert,
 * not from the timestamp — two orders created in the same millisecond
 * still get distinct sequence numbers.
 */
export const generateOrderNumber = async () => {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = `order-${datePart}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `TVS-${datePart}-${String(counter.seq).padStart(6, '0')}`;
};

export default { generateOrderNumber };