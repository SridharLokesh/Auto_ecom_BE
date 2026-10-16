import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Cart from '../models/Cart.js';
import {
  LocationRequiredError,
  getCandidatesForProductNearLocation,
  findNearbyFulfillmentNodes,
} from '../services/fulfillment/fulfillmentService.js';
import { selectBestCandidate } from '../services/fulfillment/fulfillmentScoringService.js';
import { buildFulfillmentPlan } from '../services/fulfillment/fulfillmentPlanBuilder.js';
import { repairFulfillmentNodeLinks } from '../services/fulfillment/fulfillmentSyncService.js';
import {
  resolveCustomerLocation,
  CustomerLocationError,
} from '../services/fulfillment/customerLocationService.js';
import { getDisplayDistancesForProduct } from '../services/fulfillment/displayDistanceService.js';
/* ── helpers ─────────────────────────────────────────────────────────── */

const parseLocationFromQuery = (query) => {
  const latitude = query.latitude !== undefined ? Number(query.latitude) : undefined;
  const longitude = query.longitude !== undefined ? Number(query.longitude) : undefined;
  if (latitude === undefined || longitude === undefined || Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  return { latitude, longitude };
};

const parseLocationFromBody = (body) => {
  const latitude = body?.latitude ?? body?.customerLocation?.latitude;
  const longitude = body?.longitude ?? body?.customerLocation?.longitude;
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { latitude: lat, longitude: lng };
};

const invalidLocation = (res) =>
  res.status(400).json({ code: 'INVALID_LOCATION', message: 'Valid latitude and longitude are required.' });

// Customer-facing location resolution: explicit coordinates OR a saved
// addressId belonging to the authenticated user (geocoded + cached on demand).
const sendLocationError = (res, err) =>
  res.status(err.status || 400).json({ code: err.code, message: err.message });

const log = (event, payload) => {
  // Structured, no PII beyond coarse coordinates the customer already
  // supplied for this request; never logs tokens.
  console.log(JSON.stringify({ event, ...payload, at: new Date().toISOString() }));
};

/* ── GET /api/fulfillment/nearby-inventory ─────────────────────────────
   ?productId=&latitude=&longitude=&quantity=                            */
export const getNearbyInventory = async (req, res) => {
   try {
     const { productId, quantity } = req.query;

     if (!productId || !mongoose.isValidObjectId(productId)) {
       return res.status(400).json({ message: 'Valid productId is required' });
     }
     const product = await Product.findById(productId).select('_id title').lean();
     if (!product) return res.status(404).json({ message: 'Product not found' });

     let loc;
     try {
       loc = await resolveCustomerLocation({
         userId: req.user._id,
         addressId: req.query.addressId,
         latitude: req.query.latitude,
         longitude: req.query.longitude,
       });
     } catch (locErr) {
       if (locErr instanceof CustomerLocationError) return sendLocationError(res, locErr);
       throw locErr;
     }

     const qty = Math.max(1, parseInt(quantity, 10) || 1);

     const allCandidates = await getCandidatesForProductNearLocation({
       productId, latitude: loc.latitude, longitude: loc.longitude, quantity: qty,
     });

     const eligible = allCandidates
       .filter((candidate) => candidate.isEligible)
       .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));

     const ineligible = allCandidates.filter((candidate) => !candidate.isEligible);

     // Display fallback: if NO dealer has a stock record at a nearby node
     // (e.g. inventory not linked to a location yet), still show the
     // distance of nearby dealers who actively SELL this product, using
     // the dealer's own active, geo-located nodes. Distance only — this
     // never marks the product as available/express and never touches
     // checkout, which still validates real stock.
     let offerOnlyDistances = [];
     let fallbackMeta = null;
     if (allCandidates.length === 0) {
       const fallback = await getDisplayDistancesForProduct({
         productId, latitude: loc.latitude, longitude: loc.longitude,
       });
       offerOnlyDistances = fallback.distances.map((km) => ({ distanceKm: km }));
       fallbackMeta = fallback.meta;
     }

     log('fulfillment.nearby-inventory', {
       productId,
       quantity: qty,
       candidateCount: allCandidates.length,
       eligibleCount: eligible.length,
       locationSource: loc.source,
       fallback: fallbackMeta, // why a product had no confirmed-stock dealer (server log only)
       fallbackDistanceCount: offerOnlyDistances.length,
     });

     // PRIVACY: this customer-facing endpoint exposes ONLY the distance of
     // nearby dealers (plus express eligibility for serviceable ones).
     // No dealer/node identity, ids, stock, pricing, offers or reasons are
     // ever returned. Full diagnostics remain on the admin-only /debug route.
     const toDistance = (value) => {
       const km = Number(value);
       return Number.isFinite(km) ? Math.round(km * 10) / 10 : null;
     };
     return res.json({
       product: productId,
       requestedQuantity: qty,
       available: eligible.length > 0,
       candidates: eligible.map((candidate) => ({
         distanceKm: toDistance(candidate.distanceKm),
         expressEligible: Boolean(candidate.expressEnabled),
       })),
       // Dealers outside the service area: distance only.
       alternatives: [...ineligible, ...offerOnlyDistances].map((candidate) => ({
         distanceKm: toDistance(candidate.distanceKm),
       })),
       code: eligible.length > 0 ? 'fulfillment_available' : 'no_serviceable_inventory',
     });
   } catch (err) {
     if (err instanceof LocationRequiredError) return invalidLocation(res);
     res.status(500).json({ message: err.message });
   }
 };

/* ── POST /api/fulfillment/select ──────────────────────────────────────
   { productId, quantity, customerLocation: {latitude, longitude}, fulfillmentMode } */
export const selectFulfillment = async (req, res) => {
  try {
    const { productId, quantity = 1, fulfillmentMode = 'STANDARD' } = req.body;

    if (!productId || !mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: 'Valid productId is required' });
    }
    const product = await Product.findById(productId).select('_id title').lean();
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const loc = parseLocationFromBody(req.body);
    if (!loc) return invalidLocation(res);

    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    let candidates = await getCandidatesForProductNearLocation({
      productId, latitude: loc.latitude, longitude: loc.longitude, quantity: qty,
    });
    if (fulfillmentMode === 'EXPRESS') candidates = candidates.filter((c) => c.expressEnabled);

    const best = selectBestCandidate(candidates, qty);
    log('fulfillment.select', { productId, quantity: qty, fulfillmentMode, selected: best ? best.nodeId : null });

    if (!best) return res.json({ selectedNode: null, available: false });

    res.json({
      selectedNode: best.nodeId, nodeName: best.nodeName, dealer: best.dealerId, dealerName: best.dealerName,
      inventory: best.inventoryId, availableQuantity: best.availableQuantity, distanceKm: best.distanceKm,
      expressEligible: best.expressEnabled, sellingPrice: best.sellingPrice, available: true,
    });
  } catch (err) {
    if (err instanceof LocationRequiredError) return invalidLocation(res);
    res.status(500).json({ message: err.message });
  }
};

/* ── POST /api/fulfillment/cart-plan ───────────────────────────────────
   Phase 3: the backend loads the AUTHENTICATED user's own cart from
   MongoDB — it never trusts product/price/dealer/inventory info sent
   from the frontend (§12/§13). Body only carries the customer's location.
   { latitude, longitude } (or the legacy { customerLocation: {...} } shape) */
export const getCartFulfillmentPlan = async (req, res) => {
  try {
    let loc;
    try {
      loc = await resolveCustomerLocation({
        userId: req.user._id,
        addressId: req.body?.addressId,
        latitude: req.body?.latitude ?? req.body?.customerLocation?.latitude,
        longitude: req.body?.longitude ?? req.body?.customerLocation?.longitude,
      });
    } catch (locErr) {
      if (locErr instanceof CustomerLocationError) return sendLocationError(res, locErr);
      throw locErr;
    }

    const cart = await Cart.findOne({ user: req.user._id }).lean();
    if (!cart || !cart.items?.length) {
      return res.status(400).json({ code: 'EMPTY_CART', message: 'Cart is empty.' });
    }

    const cartItems = cart.items.map((i) => ({ productId: i.product, quantity: i.quantity }));

    const plan = await buildFulfillmentPlan({ cartItems, latitude: loc.latitude, longitude: loc.longitude });

    log('fulfillment.cart-plan', {
      userId: req.user._id, itemCount: cartItems.length,
      isFulfillable: plan.isFulfillable, groupCount: plan.groups?.length || 0,
    });

    res.json(plan);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ── GET /api/fulfillment/debug ─────────────────────────────────────────
   Admin-only diagnostic view. ?productId=&latitude=&longitude=           */
export const getFulfillmentDebug = async (req, res) => {
  try {
    const { productId, quantity } = req.query;
    if (!productId || !mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: 'Valid productId is required' });
    }
    const loc = parseLocationFromQuery(req.query);
    if (!loc) return invalidLocation(res);

    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    const nearbyNodes = await findNearbyFulfillmentNodes({ latitude: loc.latitude, longitude: loc.longitude });
    const candidates = await getCandidatesForProductNearLocation({
      productId, latitude: loc.latitude, longitude: loc.longitude, quantity: qty,
    });

    const diagnostics = candidates.map((c) => ({
      nodeId: c.nodeId, nodeName: c.nodeName, dealerId: c.dealerId,
      distanceKm: c.distanceKm, serviceRadiusKm: c.serviceRadiusKm,
      availableQuantity: c.availableQuantity, requestedQuantity: c.requestedQuantity,
      expressEnabled: c.expressEnabled, isEligible: c.isEligible, reason: c.reason,
    }));

    const selected = selectBestCandidate(candidates, qty);

    res.json({
      customerLocation: { latitude: loc.latitude, longitude: loc.longitude },
      requestedQuantity: qty,
      nearbyNodes: nearbyNodes.map((n) => ({
        nodeId: String(n._id), name: n.name, type: n.type, distanceKm: Math.round(n.distanceKm * 100) / 100,
        isActive: n.isActive, serviceRadiusKm: n.serviceRadiusKm, expressEnabled: n.expressEnabled,
      })),
      candidates: diagnostics,
      selectedNode: selected ? selected.nodeId : null,
      diagnostics,
    });
  } catch (err) {
    if (err instanceof LocationRequiredError) return invalidLocation(res);
    res.status(500).json({ message: err.message });
  }
};

/* ── POST /api/fulfillment/repair-links ─────────────────────────────────
   Admin-only maintenance utility (§23). Re-syncs DealerOffer.fulfillmentNodes
   against actual InventoryItem locations — safe/idempotent, never creates
   new offers or inventory, only repairs the link between existing ones. */
export async function repairNodeLinks(req, res) {
  try {
    const result = await repairFulfillmentNodeLinks({ log: console });
    res.json({ message: 'Fulfillment node links repaired.', ...result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}

export default { getNearbyInventory, selectFulfillment, getCartFulfillmentPlan, getFulfillmentDebug, repairNodeLinks };