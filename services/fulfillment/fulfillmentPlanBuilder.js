import { planCartFulfillment } from './fulfillmentPlanner.js';

/**
 * fulfillmentPlanBuilder — Phase 3 (§10)
 * ─────────────────────────────────────────────────────────────────────────
 * Wraps the raw planner output into a stable, persistable-later "plan
 * snapshot": what was decided, for what location, and WHEN — so a future
 * checkout phase can detect staleness (§11) before trusting it. This is
 * still just a plain object; nothing here writes to the database or
 * touches InventoryItem.reserved/onHand.
 */
export const buildFulfillmentPlan = async ({ cartItems, latitude, longitude }) => {
  const plan = await planCartFulfillment({ cartItems, latitude, longitude });

  return {
    generatedAt: plan.planGeneratedAt || new Date().toISOString(),
    customerLocation: { latitude, longitude },
    isFulfillable: plan.isFulfillable,
    groups: plan.groups,
    unfulfilledItems: plan.unfulfilledItems,
    ...(plan.reason ? { reason: plan.reason } : {}),
  };
};

export default { buildFulfillmentPlan };