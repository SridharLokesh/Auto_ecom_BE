import FulfillmentGroup from '../models/FulfillmentGroup.js';
import FulfillmentEvent from '../models/FulfillmentEvent.js';
import Order from '../models/Order.js';
import {
  FulfillmentError,
  authorizeGroupAccess,
  confirmGroup,
  startPicking,
  completePicking,
  packGroup,
  readyForDispatch,
  assignDelivery,
  outForDelivery,
  markDelivered,
  cancelGroup,
} from '../services/fulfillment/fulfillmentOrchestrationService.js';

/**
 * fulfillmentGroupController — Phase 6 (§19/§29)
 * ─────────────────────────────────────────────────────────────────────────
 * Thin controllers only — every actual transition/validation rule lives
 * in fulfillmentOrchestrationService. Authorization is enforced here
 * uniformly before any service call: admin sees/touches everything, a
 * dealer only their own groups (§17).
 */

const handleServiceError = (res, err) => {
  if (err instanceof FulfillmentError) {
    const status = { FULFILLMENT_GROUP_NOT_FOUND: 404, INVALID_STATUS_TRANSITION: 409, RESERVATION_NOT_FOUND: 409 }[err.code] || 400;
    return res.status(status).json({ success: false, code: err.code, message: err.message });
  }
  console.error('[fulfillmentGroupController]', err);
  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
};

const loadAndAuthorize = async (req, res) => {
  const group = await FulfillmentGroup.findById(req.params.id);
  if (!group) {
    res.status(404).json({ success: false, code: 'FULFILLMENT_GROUP_NOT_FOUND', message: 'Fulfillment group not found.' });
    return null;
  }
  if (!authorizeGroupAccess(req.user, group)) {
    res.status(403).json({ success: false, code: 'UNAUTHORIZED_FULFILLMENT_ACCESS', message: 'Not authorized for this fulfillment group.' });
    return null;
  }
  return group;
};

// GET /api/fulfillment-groups — admin sees all, dealer sees only their own.
export const listFulfillmentGroups = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const query = req.user.role === 'admin' ? {} : { dealer: req.user._id };
    if (status) query.status = status;

    if (search) {
      const matchingOrders = await Order.find({ orderNumber: { $regex: search, $options: 'i' } }).select('_id').lean();
      query.order = { $in: matchingOrders.map((o) => o._id) };
    }

    const total = await FulfillmentGroup.countDocuments(query);
    const groups = await FulfillmentGroup.find(query)
      .populate('order', 'orderNumber orderStatus user createdAt')
      .populate('fulfillmentNode', 'name type')
      .populate('dealer', 'name businessName')
      .populate('items.product', 'title image')
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ groups, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    handleServiceError(res, err);
  }
};

// GET /api/fulfillment-groups/:id
export const getFulfillmentGroupDetail = async (req, res) => {
  try {
    const group = await loadAndAuthorize(req, res);
    if (!group) return;

    const populated = await FulfillmentGroup.findById(group._id)
      .populate('order', 'orderNumber orderStatus user shippingAddress createdAt')
      .populate('fulfillmentNode', 'name type location serviceRadiusKm')
      .populate('dealer', 'name businessName')
      .populate('items.product', 'title image')
      .populate('deliveryAssignment');

    const timeline = await FulfillmentEvent.find({ fulfillmentGroup: group._id }).sort('createdAt').lean();

    res.json({ group: populated, timeline });
  } catch (err) {
    handleServiceError(res, err);
  }
};

const makeTransitionHandler = (serviceFn, extractExtra = () => ({})) => async (req, res) => {
  try {
    const group = await loadAndAuthorize(req, res);
    if (!group) return;
    const result = await serviceFn({ groupId: group._id, actor: req.user, ...extractExtra(req) });
    res.json({ success: true, group: result.group || result, assignment: result.assignment });
  } catch (err) {
    handleServiceError(res, err);
  }
};

export const postConfirm          = makeTransitionHandler(confirmGroup);
export const postStartPicking     = makeTransitionHandler(startPicking);
export const postCompletePicking  = makeTransitionHandler(completePicking);
export const postPack             = makeTransitionHandler(packGroup, (req) => ({
  packageCount: req.body.packageCount, packageWeightKg: req.body.packageWeightKg,
  packageDimensions: req.body.packageDimensions, packagingNotes: req.body.packagingNotes,
}));
export const postReadyForDispatch = makeTransitionHandler(readyForDispatch);
export const postAssignDelivery   = makeTransitionHandler(assignDelivery, (req) => ({
  riderName: req.body.riderName, riderPhone: req.body.riderPhone,
  vehicleNumber: req.body.vehicleNumber, deliveryPartnerType: req.body.deliveryPartnerType,
}));
export const postOutForDelivery   = makeTransitionHandler(outForDelivery);
export const postDelivered        = makeTransitionHandler(markDelivered);
export const postCancel           = makeTransitionHandler(cancelGroup, (req) => ({ reason: req.body.reason }));

export default {
  listFulfillmentGroups, getFulfillmentGroupDetail,
  postConfirm, postStartPicking, postCompletePicking, postPack,
  postReadyForDispatch, postAssignDelivery, postOutForDelivery, postDelivered, postCancel,
};