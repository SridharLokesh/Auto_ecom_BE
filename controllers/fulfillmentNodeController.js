import mongoose from 'mongoose';
import User from '../models/User.js';
import FulfillmentNode from '../models/FulfillmentNode.js';
import { syncFulfillmentNode } from '../services/fulfillment/fulfillmentSyncService.js';

/* ── helpers ─────────────────────────────────────────────────────────── */

const isAdmin  = (req) => req.user?.role === 'admin';
const isDealer = (req) => req.user?.role === 'dealer';

const NODE_TYPES = ['DEALER', 'DARK_STORE', 'WAREHOUSE', 'REGIONAL_HUB', 'PARTNER_STORE'];

const validateObjectId = (value, label) => {
  if (!value) return { error: `${label} is required` };
  if (!mongoose.isValidObjectId(value)) return { error: `Invalid ${label}` };
  return {};
};

/**
 * Validate GeoJSON coordinates. Order MUST be [longitude, latitude].
 * Neither coordinate present ＝ keep null. Partial coords are rejected.
 */
const parseCoordinates = (coords) => {
  if (coords === undefined || coords === null) return { valid: true, coordinates: null };
  if (!Array.isArray(coords)) return { valid: false, error: 'location.coordinates must be an array' };
  if (coords.length === 0) return { valid: true, coordinates: null };

  if (coords.length !== 2)
    return { valid: false, error: 'location.coordinates must be exactly [longitude, latitude]' };

  const [lng, lat] = coords.map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat))
    return { valid: false, error: 'location.coordinates must be numeric [longitude, latitude]' };
  if (lng < -180 || lng > 180) return { valid: false, error: 'longitude must be between -180 and 180' };
  if (lat < -90  || lat > 90)  return { valid: false, error: 'latitude must be between -90 and 90' };

  return { valid: true, coordinates: [lng, lat] };
};

const validateBase = ({ name, type }) => {
  if (!name?.trim()) return { error: 'Node name is required' };
  if (type && !NODE_TYPES.includes(type))
    return { error: `type must be one of: ${NODE_TYPES.join(', ')}` };
  return {};
};

/* ── GET /api/fulfillment-nodes ──────────────────────────────────────── */
export const getFulfillmentNodes = async (req, res) => {
  try {
    const { type, isActive, search } = req.query;
    const match = {};
    if (type && NODE_TYPES.includes(type)) match.type = type;
    if (isActive !== undefined) match.isActive = isActive === 'true';
    if (search) match.name = { $regex: String(search).trim(), $options: 'i' };

    // Dealers only see their own nodes.
    if (isDealer(req)) match.dealer = req.user._id;

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const total = await FulfillmentNode.countDocuments(match);

    const nodes = await FulfillmentNode.find(match)
      .populate('dealer', 'name businessName dealerId')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({ nodes, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ── GET /api/fulfillment-nodes/:id ──────────────────────────────────── */
export const getFulfillmentNodeById = async (req, res) => {
  try {
    const { error } = validateObjectId(req.params.id, 'node ID');
    if (error) return res.status(400).json({ message: error });

    const node = await FulfillmentNode.findById(req.params.id)
      .populate('dealer', 'name businessName dealerId')
      .lean();
    if (!node) return res.status(404).json({ message: 'Fulfillment node not found' });

    if (isDealer(req) && node.dealer?._id?.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized to view this node' });

    res.json({ node });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
/* ── POST /api/fulfillment-nodes ─────────────────────────────────────── */
export const createFulfillmentNode = async (req, res) => {
  try {
    const { name, type, dealer, address, expressEnabled, serviceRadiusKm, isActive, location } = req.body;

    const base = validateBase({ name, type });
    if (base.error) return res.status(400).json({ message: base.error });

    // Dealers can only create their own DEALER nodes.
    let ownerDealer = null;
    if (isDealer(req)) {
      ownerDealer = req.user._id;
      if (type && type !== 'DEALER')
        return res.status(403).json({ message: 'Dealers can only create DEALER type nodes' });
    } else {
      if (dealer) {
        const dv = validateObjectId(dealer, 'dealer');
        if (dv.error) return res.status(400).json({ message: dv.error });
        const dealerDoc = await User.findOne({ _id: dealer, role: 'dealer' }).lean();
        if (!dealerDoc) return res.status(404).json({ message: 'Dealer not found' });
      }
      ownerDealer = dealer || null;
    }

    const coord = parseCoordinates(location?.coordinates);
    if (!coord.valid) return res.status(400).json({ message: coord.error });

    const node = await FulfillmentNode.create({
      name: String(name).trim(),
      type: type || 'DEALER',
      dealer: ownerDealer,
      location: { type: 'Point', coordinates: coord.coordinates },
      address: {
        street:  address?.street  || '',
        city:    address?.city    || '',
        state:   address?.state   || '',
        country: address?.country || 'India',
        pincode: address?.pincode || '',
      },
      expressEnabled:  expressEnabled  === true,
      serviceRadiusKm: serviceRadiusKm !== undefined ? Number(serviceRadiusKm) : 15,
      isActive:        isActive !== false,
    });

    // Synchronize fulfillment relationships after node creation
    try {
      await syncFulfillmentNode(node._id);
    } catch (syncErr) {
      console.error(`[fulfillmentNodeController] Sync failed for node ${node._id}:`, syncErr.message);
      // Continue — sync errors don't block the creation response
    }

    const populated = await FulfillmentNode.findById(node._id).populate('dealer', 'name businessName dealerId');
    res.status(201).json({ node: populated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
/* ── PUT /api/fulfillment-nodes/:id ──────────────────────────────────── */
export const updateFulfillmentNode = async (req, res) => {
  try {
    const { error } = validateObjectId(req.params.id, 'node ID');
    if (error) return res.status(400).json({ message: error });

    const node = await FulfillmentNode.findById(req.params.id);
    if (!node) return res.status(404).json({ message: 'Fulfillment node not found' });

    // Dealers may only edit their own DEALER nodes, and cannot change
    // ownership/type.
    if (isDealer(req)) {
      if (node.dealer?.toString() !== req.user._id.toString())
        return res.status(403).json({ message: 'Not authorized to edit this node' });
      if (node.type !== 'DEALER')
        return res.status(403).json({ message: 'Dealers cannot edit platform node types' });
    }

    const { name, address, expressEnabled, serviceRadiusKm, isActive, location } = req.body;

    const base = validateBase({ name, type: node.type });
    if (base.error) return res.status(400).json({ message: base.error });

    if (name !== undefined) node.name = String(name).trim();
    if (!isDealer(req) && req.body.type !== undefined) {
      const typeVal = String(req.body.type);
      if (!NODE_TYPES.includes(typeVal))
        return res.status(400).json({ message: `type must be one of: ${NODE_TYPES.join(', ')}` });
      node.type = typeVal;
    }
    if (!isDealer(req) && req.body.dealer !== undefined) {
      if (req.body.dealer) {
        const dv = validateObjectId(req.body.dealer, 'dealer');
        if (dv.error) return res.status(400).json({ message: dv.error });
        const dealerDoc = await User.findOne({ _id: req.body.dealer, role: 'dealer' }).lean();
        if (!dealerDoc) return res.status(404).json({ message: 'Dealer not found' });
      }
      node.dealer = req.body.dealer || null;
    }

    if (location?.coordinates !== undefined) {
      const coord = parseCoordinates(location.coordinates);
      if (!coord.valid) return res.status(400).json({ message: coord.error });
      node.location = { type: 'Point', coordinates: coord.coordinates };
    }

    if (address !== undefined) {
      node.address = {
        street:  address.street  ?? node.address.street,
        city:    address.city    ?? node.address.city,
        state:   address.state   ?? node.address.state,
        country: address.country ?? node.address.country,
        pincode: address.pincode ?? node.address.pincode,
      };
    }
    if (expressEnabled !== undefined) node.expressEnabled = expressEnabled === true || expressEnabled === 'true';
    if (serviceRadiusKm !== undefined) {
      const r = Number(serviceRadiusKm);
      if (!Number.isFinite(r) || r < 0)
        return res.status(400).json({ message: 'serviceRadiusKm must be a non-negative number' });
      node.serviceRadiusKm = r;
    }
    if (isActive !== undefined) node.isActive = isActive === true || isActive === 'true';

    await node.save();

    // Synchronize fulfillment relationships after node update
    // This ensures InventoryItem and DealerOffer records stay consistent
    // when node location, service radius, or status changes.
    try {
      await syncFulfillmentNode(node._id);
    } catch (syncErr) {
      console.error(`[fulfillmentNodeController] Sync failed for node ${node._id}:`, syncErr.message);
      // Continue — sync errors don't block the update response
    }

    const populated = await FulfillmentNode.findById(node._id).populate('dealer', 'name businessName dealerId');
    res.json({ node: populated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};