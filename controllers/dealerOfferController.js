import mongoose from 'mongoose';
import Product from '../models/Product.js';
import User from '../models/User.js';
import FulfillmentNode from '../models/FulfillmentNode.js';
import DealerOffer from '../models/DealerOffer.js';
import { buildSku } from '../services/inventory/migrationService.js';

/* ── helpers ─────────────────────────────────────────────────────────── */

const isDealer = (req) => req.user?.role === 'dealer';

const OFFER_POPULATE = [
  { path: 'product',         select: 'title brand category image partNumber productId price originalPrice' },
  { path: 'dealer',          select: 'name businessName dealerId businessLocation' },
  { path: 'fulfillmentNodes', select: 'name type address expressEnabled isActive' },
];

const validateObjectId = (value, label) => {
  if (!value) return { error: `${label} is required` };
  if (!mongoose.isValidObjectId(value)) return { error: `Invalid ${label}` };
  return {};
};

const parsePrice = (value, label) => {
  const num = Number(value);
  if (value === undefined || value === null || value === '') return { valid: false, error: `${label} is required` };
  if (!Number.isFinite(num) || num < 0) return { valid: false, error: `${label} must be a non-negative number` };
  return { valid: true, value: num };
};

/* ── GET /api/dealer-offers/product/:productId ───────────────────────── */
export const getOffersForProduct = async (req, res) => {
  try {
    const { error } = validateObjectId(req.params.productId, 'product ID');
    if (error) return res.status(400).json({ message: error });

    const product = await Product.findById(req.params.productId).lean();
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const match = { product: product._id, isActive: true };
    // Commercial isolation: dealers only see their own offers.
    if (isDealer(req)) match.dealer = req.user._id;

    const offers = await DealerOffer.find(match)
      .populate(OFFER_POPULATE)
      .sort('-createdAt')
      .lean();

    res.json({ product, offers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ── GET /api/dealer-offers/dealer/:dealerId ─────────────────────────── */
export const getOffersForDealer = async (req, res) => {
  try {
    const { error } = validateObjectId(req.params.dealerId, 'dealer ID');
    if (error) return res.status(400).json({ message: error });

    if (isDealer(req) && req.params.dealerId !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized to view this dealer offers' });

    const dealer = await User.findOne({ _id: req.params.dealerId, role: 'dealer' })
      .select('name businessName dealerId')
      .lean();
    if (!dealer) return res.status(404).json({ message: 'Dealer not found' });

    const offers = await DealerOffer.find({ dealer: dealer._id })
      .populate(OFFER_POPULATE)
      .sort('-createdAt')
      .lean();

    res.json({ dealer, offers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ── POST /api/dealer-offers ─────────────────────────────────────────── */
export const createOffer = async (req, res) => {
  try {
    const { product, sku, mrp, sellingPrice, isActive, fulfillmentNode } = req.body;

    const pv = validateObjectId(product, 'product');
    if (pv.error) return res.status(400).json({ message: pv.error });

    const productDoc = await Product.findById(product).lean();
    if (!productDoc) return res.status(404).json({ message: 'Product not found' });

    // A dealer cannot have two offers for the same product.
    const dup = await DealerOffer.findOne({ product, dealer: req.user._id });
    if (dup) return res.status(400).json({ message: 'You already have an offer for this product' });

    const sellingPriceVal = sellingPrice !== undefined
      ? parsePrice(sellingPrice, 'sellingPrice')
      : { valid: true, value: productDoc.price || 0 };
    const mrpVal = mrp !== undefined
      ? parsePrice(mrp, 'mrp')
      : { valid: true, value: productDoc.originalPrice || sellingPriceVal.value || 0 };
    if (!sellingPriceVal.valid) return res.status(400).json({ message: sellingPriceVal.error });
    if (!mrpVal.valid) return res.status(400).json({ message: mrpVal.error });

    let node = null;
    if (fulfillmentNode) {
      const nv = validateObjectId(fulfillmentNode, 'fulfillment node');
      if (nv.error) return res.status(400).json({ message: nv.error });
      node = await FulfillmentNode.findById(fulfillmentNode).lean();
      if (!node) return res.status(404).json({ message: 'Fulfillment node not found' });
    }

    const offer = await DealerOffer.create({
      product,
      dealer: req.user._id,
      sku: sku || buildSku(productDoc),
      mrp: mrpVal.value,
      sellingPrice: sellingPriceVal.value,
      isActive: isActive !== false,
      fulfillmentNodes: node ? [node._id] : [],
    });

    const populated = await DealerOffer.findById(offer._id).populate(OFFER_POPULATE);
    res.status(201).json({ offer: populated });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Duplicate dealer offer' });
    res.status(500).json({ message: err.message });
  }
};
/* ── PUT /api/dealer-offers/:id ──────────────────────────────────────── */
export const updateOffer = async (req, res) => {
  try {
    const { error } = validateObjectId(req.params.id, 'offer ID');
    if (error) return res.status(400).json({ message: error });

    const offer = await DealerOffer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Dealer offer not found' });

    // Dealers may only modify their own offers.
    if (isDealer(req) && offer.dealer.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized to modify this offer' });

    const { sku, externalSku, mrp, sellingPrice, isActive, fulfillmentNodes } = req.body;

    if (sku !== undefined) {
      const s = String(sku).trim();
      if (!s) return res.status(400).json({ message: 'SKU cannot be empty' });
      offer.sku = s;
    }
    if (externalSku !== undefined) offer.externalSku = externalSku;
    if (mrp !== undefined) {
      const r = parsePrice(mrp, 'mrp');
      if (!r.valid) return res.status(400).json({ message: r.error });
      offer.mrp = r.value;
    }
    if (sellingPrice !== undefined) {
      const r = parsePrice(sellingPrice, 'sellingPrice');
      if (!r.valid) return res.status(400).json({ message: r.error });
      offer.sellingPrice = r.value;
    }
    if (isActive !== undefined) offer.isActive = isActive === true || isActive === 'true';

    if (fulfillmentNodes !== undefined) {
      if (!Array.isArray(fulfillmentNodes)) return res.status(400).json({ message: 'fulfillmentNodes must be an array' });
      for (const n of fulfillmentNodes) {
        if (!mongoose.isValidObjectId(n)) return res.status(400).json({ message: 'Invalid fulfillment node ID' });
      }
      offer.fulfillmentNodes = fulfillmentNodes;
    }

    await offer.save();
    const populated = await DealerOffer.findById(offer._id).populate(OFFER_POPULATE);
    res.json({ offer: populated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};