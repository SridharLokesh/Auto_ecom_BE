import mongoose from 'mongoose';
import DealerOffer from '../../models/DealerOffer.js';
import FulfillmentNode from '../../models/FulfillmentNode.js';
import User from '../../models/User.js';
import { findNearbyFulfillmentNodes } from './fulfillmentService.js';
import { geocodeAddress } from '../../utils/geocode.js';

/**
 * Display-only distances ("product available around N kms away").
 *
 * Used when no dealer has a confirmed stock record at a located node, so the
 * customer still sees how far the dealers who SELL the product are.
 * It NEVER writes to the database, never marks anything available/express,
 * and never affects checkout (which validates real stock + node coordinates).
 *
 * Order of attempts:
 *   1. Dealers with an active offer for the product → their located,
 *      active nodes (no 300 km cap — all-India).
 *   2. Those dealers' active nodes that have NO coordinates yet → geocode the
 *      node's address (cached in memory) and measure the distance.
 *   3. Dealers with no node at all → geocode the dealer's business location.
 */
const DISPLAY_RADIUS_KM = 5000;
const MAX_GEOCODES_PER_REQUEST = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const geoCache = new Map(); // key -> { point | null, at }

const toRad = (deg) => (deg * Math.PI) / 180;
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const cachedGeocode = async (key, address, budget) => {
  const hit = geoCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.point;
  if (budget.left <= 0) return undefined; // out of geocode budget → skip, don't cache
  budget.left -= 1;
  const point = await geocodeAddress(address);
  geoCache.set(key, { point, at: Date.now() });
  return point;
};

const hasText = (a) => a && [a.street, a.city, a.state, a.pincode].some((v) => String(v || '').trim());

export const getDisplayDistancesForProduct = async ({ productId, latitude, longitude }) => {
  const offers = await DealerOffer.find({ product: productId, isActive: true }).select('dealer').lean();
  const dealerIds = [...new Set(offers.map((o) => String(o.dealer)))]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const meta = { offerCount: dealerIds.length, locatedNodes: 0, geocodedNodes: 0, geocodedDealers: 0 };
  if (dealerIds.length === 0) return { distances: [], meta };

  // 1) located nodes
  const located = await findNearbyFulfillmentNodes({
    latitude, longitude,
    maxRadiusKm: DISPLAY_RADIUS_KM,
    hardCapKm: DISPLAY_RADIUS_KM,
    extraMatch: { dealer: { $in: dealerIds } },
  });
  if (located.length > 0) {
    meta.locatedNodes = located.length;
    return { distances: located.map((n) => Number(n.distanceKm)), meta };
  }

  // 2) active nodes without coordinates → geocode their address
  const budget = { left: MAX_GEOCODES_PER_REQUEST };
  const distances = [];
  const unlocated = await FulfillmentNode.find({
    dealer: { $in: dealerIds },
    isActive: true,
    'location.coordinates.0': { $exists: false },
  }).select('address dealer').lean();

  const dealersWithNodes = new Set(unlocated.map((n) => String(n.dealer)));
  for (const node of unlocated) {
    if (!hasText(node.address)) continue;
    const point = await cachedGeocode(`node:${node._id}:${JSON.stringify(node.address)}`, node.address, budget);
    if (point) {
      distances.push(haversineKm(latitude, longitude, point.latitude, point.longitude));
      meta.geocodedNodes += 1;
    }
  }
  if (distances.length > 0) return { distances, meta };

  // 3) dealers with no usable node → geocode the dealer's business location
  const dealers = await User.find({ _id: { $in: dealerIds } })
    .select('businessLocation dealerState').lean();
  for (const dealer of dealers) {
    if (dealersWithNodes.has(String(dealer._id)) && unlocated.some((n) => hasText(n.address))) continue;
    const place = String(dealer.businessLocation || '').trim();
    if (!place) continue;
    const point = await cachedGeocode(
      `dealer:${dealer._id}:${place}:${dealer.dealerState || ''}`,
      { city: place, state: dealer.dealerState || '' },
      budget,
    );
    if (point) {
      distances.push(haversineKm(latitude, longitude, point.latitude, point.longitude));
      meta.geocodedDealers += 1;
    }
  }
  return { distances, meta };
};

export default { getDisplayDistancesForProduct };