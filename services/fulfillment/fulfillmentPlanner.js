import {
  getCandidatesForProductsNearLocation,
  pickMostUsefulReason,
} from './fulfillmentService.js';
import { rankCandidates } from './fulfillmentScoringService.js';

/**
 * fulfillmentPlanner — Phase 3
 * ─────────────────────────────────────────────────────────────────────────
 * Cart-level fulfillment grouping. Planning only — never reserves or
 * deducts inventory, never creates orders (§29).
 *
 * Strategy (deterministic, no external solver — §5/§31):
 *   1. Batch-fetch every cart line's eligible candidates in ONE geo query
 *      + ONE inventory query + ONE offer query (§26), not N of each.
 *   2. Items with zero eligible candidates become `unfulfilledItems` with
 *      the most useful reason (§7/§8) — never silently dropped.
 *   3. Among fulfillable items, prefer the SINGLE node that covers all of
 *      them (§4). If none does, greedily pick the node covering the most
 *      remaining items, repeat until every fulfillable item is grouped —
 *      a standard greedy set-cover heuristic: deterministic, minimizes
 *      node count without exhaustive search (§5).
 */

const toGroupItem = (item, candidate) => ({
  productId: item.productId,
  inventoryId: candidate.inventoryId,
  dealerOfferId: candidate.offerId,
  quantity: item.quantity,
  unitPrice: candidate.sellingPrice,
  availableQuantity: candidate.availableQuantity,
});

const toGroup = (candidate, items) => ({
  fulfillmentNodeId: candidate.nodeId,
  dealerId: candidate.dealerId,
  nodeName: candidate.nodeName,
  nodeType: candidate.nodeType,
  distanceKm: candidate.distanceKm,
  expressEnabled: candidate.expressEnabled,
  items,
});

// Deterministic node tie-break: express-enabled first, then nearest,
// then a stable string compare so re-runs against unchanged data always
// pick the same node.
const compareNodesForCoverage = (a, b) => {
  if (a.expressEnabled !== b.expressEnabled) return a.expressEnabled ? -1 : 1;
  if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
  return String(a.nodeId).localeCompare(String(b.nodeId));
};

const buildCoverageMap = (items) => {
  const coverage = new Map(); // nodeId -> { count, meta, entries: [{item, candidate}] }
  for (const item of items) {
    for (const candidate of item.eligible) {
      if (!coverage.has(candidate.nodeId)) coverage.set(candidate.nodeId, { count: 0, meta: candidate, entries: [] });
      const entry = coverage.get(candidate.nodeId);
      entry.count += 1;
      entry.entries.push({ item, candidate });
    }
  }
  return coverage;
};

const bestNode = (coverage) =>
  [...coverage.entries()].sort((a, b) => b[1].count - a[1].count || compareNodesForCoverage(a[1].meta, b[1].meta))[0][1];

export const planCartFulfillment = async ({ cartItems = [], latitude, longitude }) => {
  if (!cartItems.length) {
    return {
      isFulfillable: false,
      groups: [],
      unfulfilledItems: [],
      reason: 'EMPTY_CART',
      planGeneratedAt: new Date().toISOString(),
    };
  }

  const productIds = cartItems.map((i) => i.productId);
  const quantityByProduct = new Map(cartItems.map((i) => [String(i.productId), i.quantity]));

  const { candidatesByProduct } = await getCandidatesForProductsNearLocation({
    productIds,
    quantityByProduct,
    latitude,
    longitude,
  });

  // Rank each item's eligible candidates best-first.
  const perItem = cartItems.map((i) => {
    const all = candidatesByProduct.get(String(i.productId)) || [];
    const eligible = rankCandidates(all.filter((c) => c.isEligible));
    const ineligibleReasons = all.filter((c) => !c.isEligible).map((c) => c.reason);
    return { productId: i.productId, quantity: i.quantity, eligible, ineligibleReasons };
  });

  const unfulfilledItems = perItem
    .filter((i) => i.eligible.length === 0)
    .map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      reason: pickMostUsefulReason(i.ineligibleReasons),
    }));

  const fulfillableItems = perItem.filter((i) => i.eligible.length > 0);

  if (!fulfillableItems.length) {
    return { isFulfillable: false, groups: [], unfulfilledItems, planGeneratedAt: new Date().toISOString() };
  }

  // ── Does ONE node cover every fulfillable item? (§4 — strongly preferred) */
  const fullCoverage = buildCoverageMap(fulfillableItems);
  const topFull = bestNode(fullCoverage);

  const groups = [];

  if (topFull.count === fulfillableItems.length) {
    groups.push(toGroup(topFull.meta, topFull.entries.map(({ item, candidate }) => toGroupItem(item, candidate))));
  } else {
    // Greedy set-cover: repeatedly take the node covering the most of
    // what's still ungrouped, until every fulfillable item is placed.
    let remaining = fulfillableItems;
    while (remaining.length) {
      const coverage = buildCoverageMap(remaining);
      const best = bestNode(coverage);
      groups.push(toGroup(best.meta, best.entries.map(({ item, candidate }) => toGroupItem(item, candidate))));

      const covered = new Set(best.entries.map(({ item }) => String(item.productId)));
      remaining = remaining.filter((i) => !covered.has(String(i.productId)));
    }
  }

  return {
    isFulfillable: unfulfilledItems.length === 0,
    groups,
    unfulfilledItems,
    planGeneratedAt: new Date().toISOString(),
  };
};

export default { planCartFulfillment };