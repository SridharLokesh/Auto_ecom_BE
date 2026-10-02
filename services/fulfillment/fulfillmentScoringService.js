/**
 * fulfillmentScoringService — Phase 2
 * ─────────────────────────────────────────────────────────────────────────
 * Deterministic candidate ranking. No ML, no weighted magic numbers —
 * a simple ordered-priority sort per §16:
 *
 *   1. Serviceability          (must be isEligible)
 *   2. Sufficient stock         (availableQuantity >= requestedQuantity)
 *   3. Express capability first (expressEnabled)
 *   4. Nearest distance
 *   5. Deterministic tie-break  (inventoryId string compare)
 */

/** Filter candidates down to ones that can actually serve `quantity` units. */
export const filterServiceable = (candidates, quantity = 1) =>
  candidates.filter((c) => c.isEligible && c.availableQuantity >= quantity);

/**
 * Sort serviceable candidates best-first:
 * express-enabled > nearer > higher stock > stable tie-break.
 */
export const rankCandidates = (candidates) =>
  [...candidates].sort((a, b) => {
    // 1. Express-enabled candidates first.
    if (a.expressEnabled !== b.expressEnabled) return a.expressEnabled ? -1 : 1;
    // 2. Nearest distance.
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    // 3. More available stock (marginally prefers deeper stock on ties).
    if (a.availableQuantity !== b.availableQuantity) return b.availableQuantity - a.availableQuantity;
    // 4. Deterministic tie-breaker.
    return String(a.inventoryId).localeCompare(String(b.inventoryId));
  });

/**
 * Select the single best fulfillment candidate for a requested quantity.
 * Returns null when nothing can serve the full quantity (§17 — never
 * picks a nearer node that can't cover the order; §18 — never fabricates
 * availability).
 */
export const selectBestCandidate = (candidates, quantity = 1) => {
  const serviceable = filterServiceable(candidates, quantity);
  if (!serviceable.length) return null;
  return rankCandidates(serviceable)[0];
};

export default { filterServiceable, rankCandidates, selectBestCandidate };