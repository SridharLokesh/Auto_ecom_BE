import User from '../../models/User.js';
import Product from '../../models/Product.js';
import FulfillmentNode from '../../models/FulfillmentNode.js';
import DealerOffer from '../../models/DealerOffer.js';
import InventoryItem from '../../models/InventoryItem.js';
import { syncOfferNodeForInventory } from '../fulfillment/fulfillmentSyncService.js';

/**
 * IDEMPOTENT INVENTORY MIGRATION SERVICE
 * ─────────────────────────────────────────────────────────────────────────
 * Migrates existing dealer-owned products into the new distributed
 * inventory model WITHOUT touching the original product documents:
 *
 *   Existing Product
 *        ├── dealer            → DealerOffer.dealer / InventoryItem.dealer
 *        ├── price             → DealerOffer.sellingPrice
 *        ├── originalPrice     → DealerOffer.mrp
 *        ├── stock             → InventoryItem.onHand
 *        └── dealer location   → FulfillmentNode (DEALER)
 *
 * Every "find or create" step is guarded by unique indexes + a lookup,
 * so running the migration repeatedly never creates duplicates. Coordinates
 * are never invented — if the dealer has no lat/lng the node is created
 * with nullable coordinates.
 */

export const buildSku = (product) => {
  if (product?.partNumber) return String(product.partNumber);
  if (product?.productId) return `TVS-${product.productId}`;
  return `TVS-${String(product?._id || '').slice(-6).toUpperCase()}`;
};

/** Find the dealer's DEALER-type node or create one from available info. */
export const findOrCreateDealerNode = async (dealer) => {
  let node = await FulfillmentNode.findOne({
    dealer: dealer._id,
    type: 'DEALER',
  });

  if (node) return { node, created: false };

  const defaultAddr =
    (dealer.addresses || []).find((a) => a.isDefault) ||
    (dealer.addresses || [])[0] ||
    {};

  const address = {
    street: dealer.businessLocation || defaultAddr.street || '',
    city: defaultAddr.city || '',
    state: dealer.dealerState || defaultAddr.state || '',
    country: defaultAddr.country || 'India',
    pincode: defaultAddr.pincode || '',
  };

  const locationName =
    dealer.businessLocation ||
    [defaultAddr.city, defaultAddr.state].filter(Boolean).join(', ') ||
    'Dealer Location';

  node = await FulfillmentNode.create({
    name: `${dealer.businessName || dealer.name} — ${locationName}`,
    type: 'DEALER',
    dealer: dealer._id,
    address,
    isActive: true,
  });

  return { node, created: true };
};

/** Find the dealer's offer for a product, or create it from product pricing. */
export const findOrCreateOffer = async ({ product, dealer, node }) => {
  let offer = await DealerOffer.findOne({
    product: product._id,
    dealer: dealer._id,
  });
  if (offer) return { offer, created: false };

  const sku = buildSku(product);
  try {
    offer = await DealerOffer.create({
      product: product._id,
      dealer: dealer._id,
      sku,
      mrp: product.originalPrice || product.price || 0,
      sellingPrice: product.price || 0,
      isActive: true,
      fulfillmentNodes: [node._id],
    });
    return { offer, created: true };
  } catch (err) {
    // Duplicate-key race with a concurrent run → return the existing offer.
    if (err.code === 11000) {
      offer = await DealerOffer.findOne({ product: product._id, dealer: dealer._id });
      return { offer, created: false };
    }
    throw err;
  }
};
/** Find the inventory row for (product, dealer, node), or create it. */
export const findOrCreateInventoryItem = async ({ product, dealer, node, offer }) => {
  let inventory = await InventoryItem.findOne({
    product: product._id,
    dealer: dealer._id,
    fulfillmentNode: node._id,
  });
  if (inventory) {
    await syncOfferNodeForInventory({ product: product._id, dealer: dealer._id, fulfillmentNode: node._id });
    return { inventory, created: false };
  }

  try {
    inventory = await InventoryItem.create({
      product: product._id,
      dealer: dealer._id,
      fulfillmentNode: node._id,
      sku: offer.sku,
      onHand: product.stock || 0,
      reserved: 0,
      damaged: 0,
      blocked: 0,
      isActive: true,
    });
    // Keep the offer's fulfillment-node whitelist in sync (§23) — a new
    // inventory row at a node the offer doesn't yet list would otherwise
    // be an invisible NODE_NOT_IN_OFFER candidate.
    await syncOfferNodeForInventory({ product: product._id, dealer: dealer._id, fulfillmentNode: node._id });
    return { inventory, created: true };
  } catch (err) {
    if (err.code === 11000) {
      inventory = await InventoryItem.findOne({
        product: product._id,
        dealer: dealer._id,
        fulfillmentNode: node._id,
      });
      return { inventory, created: false };
    }
    throw err;
  }
};
/**
 * Ensure a dealer-owned product has an offer + inventory node/row.
 * Used by the migration AND by the existing product create/update flow so
 * new dealer products get the new model automatically. Existing rows are
 * never overwritten.
 */
export const ensureOfferAndInventoryForProduct = async (product) => {
  if (!product?.dealer) return { skipped: true };

  const dealer = await User.findById(product.dealer);
  if (!dealer || dealer.role !== 'dealer') return { skipped: true };

  const { node, created: nodeCreated } = await findOrCreateDealerNode(dealer);
  const { offer, created: offerCreated } = await findOrCreateOffer({ product, dealer, node });
  const { inventory, created: inventoryCreated } = await findOrCreateInventoryItem({
    product,
    dealer,
    node,
    offer,
  });

  return { node, offer, inventory, nodeCreated, offerCreated, inventoryCreated };
};

/**
 * Sync commercial terms of an existing offer (SKU / MRP / selling price)
 * after the dealer edits the product. Quantities are intentionally NOT
 * touched here — inventory onHand is the dealer's own, adjusted from the
 * Inventory tab.
 */
export const syncOfferAfterProductUpdate = async (product) => {
  if (!product?.dealer) return null;
  const offer = await DealerOffer.findOne({ product: product._id, dealer: product.dealer });
  if (!offer) return null;

  const sku = buildSku(product);
  let changed = false;
  if (offer.sku !== sku) { offer.sku = sku; changed = true; }
  if (offer.sellingPrice !== product.price) { offer.sellingPrice = product.price || 0; changed = true; }
  if (offer.mrp !== (product.originalPrice || product.price)) {
    offer.mrp = product.originalPrice || product.price || 0;
    changed = true;
  }
  if (changed) await offer.save();
  return offer;
};

/** Remove offers + inventory rows for a product being deleted (no orphans). */
export const deleteInventoryForProduct = async (productId) => {
  await DealerOffer.deleteMany({ product: productId });
  await InventoryItem.deleteMany({ product: productId });
  return true;
};

/**
 * Run the full idempotent migration.
 * Returns a summary of what was created vs skipped.
 */
export const runMigration = async ({ log = console } = {}) => {
  const stats = {
    dealerProductsScanned: 0,
    dealersProcessed: 0,
    nodesCreated: 0,
    offersCreated: 0,
    offersSkipped: 0,
    inventoryCreated: 0,
    inventorySkipped: 0,
  };

  const dealerProducts = await Product.find({ dealer: { $ne: null } }).lean();
  const dealerIds = new Set();

  for (const product of dealerProducts) {
    stats.dealerProductsScanned += 1;

    const dealer = await User.findById(product.dealer).lean();
    if (!dealer || dealer.role !== 'dealer') {
      log(`⚠️  Skipping product ${product._id} — dealer missing or not a dealer`);
      continue;
    }
    dealerIds.add(dealer._id.toString());

    const { node, created: nodeCreated } = await findOrCreateDealerNode(dealer);
    if (nodeCreated) stats.nodesCreated += 1;

    const { offer, created: offerCreated } = await findOrCreateOffer({ product, dealer, node });
    if (offerCreated) stats.offersCreated += 1;
    else stats.offersSkipped += 1;

    const { created: invCreated } = await findOrCreateInventoryItem({ product, dealer, node, offer });
    if (invCreated) stats.inventoryCreated += 1;
    else stats.inventorySkipped += 1;
  }

  stats.dealersProcessed = dealerIds.size;
  return stats;
};