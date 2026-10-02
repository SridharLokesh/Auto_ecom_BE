import mongoose from 'mongoose';
import DealerOffer from '../../models/DealerOffer.js';
import InventoryItem from '../../models/InventoryItem.js';
import FulfillmentNode from '../../models/FulfillmentNode.js';

/**
 * Synchronizes DealerOffer.fulfillmentNodes from physical inventory.
 *
 * InventoryItem.fulfillmentNode is the source of truth. This service only
 * repairs/updates the denormalized DealerOffer.fulfillmentNodes array.
 */

export const syncOfferNodeForInventory = async (inventory, options = {}) => {
  if (!inventory?.product || !inventory?.dealer || !inventory?.fulfillmentNode) {
    return null;
  }

  const productId = inventory.product?._id || inventory.product;
  const dealerId = inventory.dealer?._id || inventory.dealer;
  const nodeId = inventory.fulfillmentNode?._id || inventory.fulfillmentNode;

  if (
    !mongoose.isValidObjectId(productId) ||
    !mongoose.isValidObjectId(dealerId) ||
    !mongoose.isValidObjectId(nodeId)
  ) {
    return null;
  }

  const offer = await DealerOffer.findOneAndUpdate(
    { product: productId, dealer: dealerId },
    { $addToSet: { fulfillmentNodes: nodeId } },
    { new: true },
  );

  if (options.log && offer) {
    options.log.info?.(
      `Synced fulfillment node ${nodeId} to offer ${offer._id}`,
    );
  }

  return offer;
};

export const syncFulfillmentNode = async (nodeId, options = {}) => {
  if (!mongoose.isValidObjectId(nodeId)) return { nodeId, synced: 0 };

  const node = await FulfillmentNode.findById(nodeId).select('_id isActive').lean();
  if (!node) return { nodeId, synced: 0 };

  const inventoryRows = await InventoryItem.find({
    fulfillmentNode: node._id,
    isActive: true,
  })
    .select('product dealer fulfillmentNode')
    .lean();

  let synced = 0;
  for (const inventory of inventoryRows) {
    const offer = await syncOfferNodeForInventory(inventory, options);
    if (offer) synced += 1;
  }

  return { nodeId: String(nodeId), synced };
};

/**
 * Full repair. Existing offers are never created by this method; only their
 * node arrays are rebuilt from active InventoryItem records.
 */
export const repairFulfillmentNodeLinks = async ({ log = console } = {}) => {
  const [offers, inventoryRows] = await Promise.all([
    DealerOffer.find({}).select('_id product dealer fulfillmentNodes').lean(),
    InventoryItem.find({ isActive: true })
      .select('product dealer fulfillmentNode')
      .lean(),
  ]);

  const nodesByOffer = new Map();
  for (const inventory of inventoryRows) {
    if (!inventory.product || !inventory.dealer || !inventory.fulfillmentNode) continue;

    const key = `${inventory.product}:${inventory.dealer}`;
    if (!nodesByOffer.has(key)) nodesByOffer.set(key, new Set());
    nodesByOffer.get(key).add(String(inventory.fulfillmentNode));
  }

  let repaired = 0;
  let cleared = 0;

  for (const offer of offers) {
    const key = `${offer.product}:${offer.dealer}`;
    const nodeIds = [...(nodesByOffer.get(key) || new Set())];

    const current = (offer.fulfillmentNodes || []).map(String).sort();
    const next = [...nodeIds].sort();

    if (JSON.stringify(current) === JSON.stringify(next)) continue;

    await DealerOffer.updateOne(
      { _id: offer._id },
      { $set: { fulfillmentNodes: nodeIds } },
    );

    repaired += 1;
    if (!nodeIds.length) cleared += 1;
  }

  log.info?.(
    `Fulfillment link repair complete: ${repaired} offers repaired, ${cleared} cleared.`,
  );

  return {
    repaired,
    cleared,
    inventoryRows: inventoryRows.length,
  };
};

export default {
  syncOfferNodeForInventory,
  syncFulfillmentNode,
  repairFulfillmentNodeLinks,
};
