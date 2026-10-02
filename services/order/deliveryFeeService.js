/**
 * deliveryFeeService — Phase 5 (§15)
 * ─────────────────────────────────────────────────────────────────────────
 * Deliberately trivial for now — just an abstraction boundary so a real
 * pricing engine (distance-based, express surcharge, free-delivery
 * threshold, per-shipment fees, courier-specific pricing) can be dropped
 * in later without touching orderService's call site.
 */
export const calculateDeliveryFee = ({ fulfillmentGroup, subtotal } = {}) => {
  // No delivery pricing engine yet — every shipment is currently free.
  return 0;
};

export default { calculateDeliveryFee };