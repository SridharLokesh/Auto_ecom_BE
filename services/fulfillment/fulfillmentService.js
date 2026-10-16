import mongoose from 'mongoose';
import FulfillmentNode from '../../models/FulfillmentNode.js';
import InventoryItem from '../../models/InventoryItem.js';
import DealerOffer from '../../models/DealerOffer.js';

/**
 * Fulfillment discovery / serviceability.
 *
 * Source of truth for physical stock location:
 *   InventoryItem.fulfillmentNode
 *
 * DealerOffer.fulfillmentNodes is only a synchronized reference/optimization
 * field. It must never hide valid physical inventory from discovery.
 *
 * This service is read-only. It never reserves or mutates stock.
 */
const MAX_SEARCH_RADIUS_KM = 300;

export class LocationRequiredError extends Error {
  constructor() {
    super('location_required');
    this.name = 'LocationRequiredError';
  }
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

const REASON_PRIORITY = [
  'INSUFFICIENT_STOCK',
  'NO_AVAILABLE_STOCK',
  'INACTIVE_INVENTORY',
  'NO_ACTIVE_OFFER',
  'OUTSIDE_SERVICE_RADIUS',
  'INACTIVE_NODE',
  'NO_COORDINATES',
];

const availableFromInventory = (item) => Math.max(
  0,
  Number(item?.onHand || 0) -
    Number(item?.reserved || 0) -
    Number(item?.damaged || 0) -
    Number(item?.blocked || 0),
);

const validateCoordinates = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new LocationRequiredError();
  }

  return { lat, lng };
};

const diagnose = ({ node, offer, inventory, distanceKm, requestedQuantity }) => {
  if (distanceKm === null || distanceKm === undefined) return 'NO_COORDINATES';
  if (node?.isActive === false) return 'INACTIVE_NODE';

  const serviceRadiusKm = Math.max(0, Number(node?.serviceRadiusKm ?? 15));
  if (distanceKm > serviceRadiusKm) return 'OUTSIDE_SERVICE_RADIUS';

  if (!offer || offer.isActive === false) return 'NO_ACTIVE_OFFER';
  if (!inventory) return 'NO_AVAILABLE_STOCK';
  if (inventory.isActive === false) return 'INACTIVE_INVENTORY';

  const available = availableFromInventory(inventory);
  if (available <= 0) return 'NO_AVAILABLE_STOCK';
  if (Number(requestedQuantity) > available) return 'INSUFFICIENT_STOCK';

  return 'ELIGIBLE';
};

export const pickMostUsefulReason = (reasons = []) => {
  if (!reasons.length) return 'NO_FULFILLMENT_NODE';
  for (const reason of REASON_PRIORITY) {
    if (reasons.includes(reason)) return reason;
  }
  return reasons[0];
};

/** Find physically located active nodes around the customer. */
export const findNearbyFulfillmentNodes = async ({
  latitude,
  longitude,
  maxRadiusKm = MAX_SEARCH_RADIUS_KM,
  hardCapKm = MAX_SEARCH_RADIUS_KM, // only display-only lookups raise this
  extraMatch = {},
} = {}) => {
  const { lat, lng } = validateCoordinates(latitude, longitude);
  const radius = Math.min(
    hardCapKm,
    Math.max(0.1, Number(maxRadiusKm) || MAX_SEARCH_RADIUS_KM),
  );

  return FulfillmentNode.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceMeters',
        spherical: true,
        maxDistance: radius * 1000,
        query: {
          isActive: true,
          'location.type': 'Point',
          ...extraMatch,
        },
      },
    },
    {
      $addFields: {
        distanceKm: {
          $round: [{ $divide: ['$distanceMeters', 1000] }, 2],
        },
      },
    },
  ]);
};

/**
 * Build product candidates from actual inventory rows at the nearby nodes.
 * InventoryItem.fulfillmentNode is authoritative.
 */
export const buildCandidatesForProducts = async ({
  productIds,
  nodes,
  quantityByProduct = new Map(),
}) => {
  const validProductIds = (productIds || []).filter((id) => mongoose.isValidObjectId(id));
  const result = new Map(validProductIds.map((id) => [String(id), []]));

  if (!validProductIds.length || !nodes?.length) return result;

  const nodeIds = nodes.map((node) => node._id);
  const nodeMetaById = new Map(nodes.map((node) => [String(node._id), node]));

  const [inventoryRows, offers] = await Promise.all([
    InventoryItem.find({
      product: { $in: validProductIds },
      fulfillmentNode: { $in: nodeIds },
    })
      .populate('dealer', 'name businessName dealerId')
      .populate(
        'fulfillmentNode',
        'name type expressEnabled serviceRadiusKm isActive location',
      )
      .lean(),
    DealerOffer.find({
      product: { $in: validProductIds },
      isActive: true,
    })
      .lean(),
  ]);

  const inventoryByKey = new Map();
  for (const item of inventoryRows) {
    if (!item.fulfillmentNode || !item.dealer) continue;
    inventoryByKey.set(
      `${item.product}:${item.dealer._id}:${item.fulfillmentNode._id}`,
      item,
    );
  }

  const offerByKey = new Map();
  for (const offer of offers) {
    offerByKey.set(`${offer.product}:${offer.dealer}`, offer);
  }

  // Build candidates ONLY from physical inventory at the nearby nodes.
  // This prevents an offer-only record from fabricating a fulfillment node.
  for (const inventory of inventoryRows) {
    if (!inventory.fulfillmentNode || !inventory.dealer) continue;

    const productId = String(inventory.product);
    if (!result.has(productId)) continue;

    const dealerId = String(inventory.dealer._id);
    const nodeId = String(inventory.fulfillmentNode._id);
    const nodeMeta = nodeMetaById.get(nodeId);
    if (!nodeMeta) continue;

    const offer = offerByKey.get(`${productId}:${dealerId}`);
    const requestedQuantity = Math.max(
      1,
      Number(quantityByProduct.get(productId) || 1),
    );
    const distanceKm = Number.isFinite(Number(nodeMeta.distanceKm))
      ? round2(nodeMeta.distanceKm)
      : null;

    const reason = diagnose({
      node: nodeMeta,
      offer,
      inventory,
      distanceKm,
      requestedQuantity,
    });

    const availableQuantity = availableFromInventory(inventory);

    result.get(productId).push({
      nodeId,
      nodeName: nodeMeta.name || 'Fulfillment Node',
      nodeType: nodeMeta.type || 'DEALER',
      dealerId,
      dealerName:
        inventory.dealer.businessName ||
        inventory.dealer.name ||
        'Dealer',
      productId,
      inventoryId: String(inventory._id),
      offerId: offer ? String(offer._id) : null,
      sellingPrice: offer?.sellingPrice ?? null,
      mrp: offer?.mrp ?? null,
      availableQuantity,
      distanceKm,
      serviceRadiusKm: Math.max(0, Number(nodeMeta.serviceRadiusKm ?? 15)),
      expressEnabled: Boolean(nodeMeta.expressEnabled),
      requestedQuantity,
      reason,
      isEligible: reason === 'ELIGIBLE',
    });
  }

  // Sort nearest first for deterministic API/planner behavior.
  for (const candidates of result.values()) {
    candidates.sort((a, b) => {
      const distanceDiff = (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      if (distanceDiff !== 0) return distanceDiff;
      return String(a.nodeId).localeCompare(String(b.nodeId));
    });
  }

  return result;
};

export const buildCandidatesForProduct = async ({ productId, nodes, quantity = 1 }) => {
  if (!mongoose.isValidObjectId(productId)) return [];

  const map = await buildCandidatesForProducts({
    productIds: [productId],
    nodes,
    quantityByProduct: new Map([[String(productId), quantity]]),
  });

  return map.get(String(productId)) || [];
};

export const getCandidatesForProductsNearLocation = async ({
  productIds,
  quantityByProduct,
  latitude,
  longitude,
  radiusKm,
}) => {
  const nodes = await findNearbyFulfillmentNodes({
    latitude,
    longitude,
    maxRadiusKm: radiusKm || MAX_SEARCH_RADIUS_KM,
  });

  return {
    nodes,
    candidatesByProduct: await buildCandidatesForProducts({
      productIds,
      nodes,
      quantityByProduct,
    }),
  };
};

export const getCandidatesForProductNearLocation = async ({
  productId,
  latitude,
  longitude,
  radiusKm,
  quantity = 1,
}) => {
  const nodes = await findNearbyFulfillmentNodes({
    latitude,
    longitude,
    maxRadiusKm: radiusKm || MAX_SEARCH_RADIUS_KM,
  });

  return buildCandidatesForProduct({ productId, nodes, quantity });
};

export default {
  LocationRequiredError,
  findNearbyFulfillmentNodes,
  buildCandidatesForProduct,
  buildCandidatesForProducts,
  getCandidatesForProductNearLocation,
  getCandidatesForProductsNearLocation,
  pickMostUsefulReason,
};