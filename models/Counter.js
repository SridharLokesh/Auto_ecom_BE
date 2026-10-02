import mongoose from 'mongoose';

/**
 * Counter — tiny atomic sequence generator, used by orderNumberService.
 * `findOneAndUpdate` with `$inc` + `upsert` is itself atomic, so
 * concurrent order creations can never collide on the same sequence
 * number (§9 — order numbers must be unique even under concurrency).
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);
export default Counter;