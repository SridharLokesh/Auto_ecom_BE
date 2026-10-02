import InventoryItem from '../../models/InventoryItem.js';

/**
 * inventoryReservationService
 * ─────────────────────────────────────────────────────────────────────────
 * Manages inventory reservations when orders are placed/cancelled.
 * 
 * Reservation Flow:
 *   1. Order placed → reserve inventory (increment reserved field)
 *   2. Available stock automatically reduces: available = onHand - reserved - damaged - blocked
 *   3. Order confirmed → keep reservation (can later convert to deduction when shipped)
 *   4. Order cancelled → release reservation (decrement reserved field)
 * 
 * This service NEVER modifies onHand. It only manages the `reserved` field.
 */

/**
 * Reserve inventory for an order item
 * 
 * @param {string} productId - Product ID
 * @param {string} dealerId - Dealer ID
 * @param {number} quantity - Quantity to reserve
 * @param {string} fulfillmentNodeId - (Optional) FulfillmentNode ID to reserve from
 * @returns {Object} Reserved inventory item with details
 * @throws {Error} If insufficient available stock or inventory not found
 */
export const reserveInventory = async ({ productId, dealerId, quantity, fulfillmentNodeId = null }) => {
  if (!productId || !dealerId) {
    throw new Error('productId and dealerId are required');
  }
  if (quantity < 1) {
    throw new Error('Quantity must be at least 1');
  }

  // Find inventory item to reserve from
  const query = {
    product: productId,
    dealer: dealerId,
    isActive: true,
  };

  if (fulfillmentNodeId) {
    query.fulfillmentNode = fulfillmentNodeId;
  }

  // If no specific node, get the one with highest available stock
  const inventoryItems = await InventoryItem.find(query);
  if (!inventoryItems.length) {
    throw new Error(`No active inventory found for product ${productId} from dealer ${dealerId}`);
  }

  let targetInventory = inventoryItems[0];
  if (!fulfillmentNodeId && inventoryItems.length > 1) {
    // Find the inventory with highest available stock
    targetInventory = inventoryItems.reduce((best, curr) => {
      const bestAvailable = Math.max(0, (best.onHand || 0) - (best.reserved || 0) - (best.damaged || 0) - (best.blocked || 0));
      const currAvailable = Math.max(0, (curr.onHand || 0) - (curr.reserved || 0) - (curr.damaged || 0) - (curr.blocked || 0));
      return currAvailable > bestAvailable ? curr : best;
    });
  }

  // Check if sufficient available stock exists
  const available = Math.max(0, (targetInventory.onHand || 0) - (targetInventory.reserved || 0) - (targetInventory.damaged || 0) - (targetInventory.blocked || 0));
  if (available < quantity) {
    throw new Error(`Insufficient available stock. Available: ${available}, Requested: ${quantity}`);
  }

  // Reserve the inventory
  targetInventory.reserved = (targetInventory.reserved || 0) + quantity;
  targetInventory.lastUpdatedAt = new Date();
  await targetInventory.save();

  return {
    inventoryId: targetInventory._id,
    fulfillmentNodeId: targetInventory.fulfillmentNode,
    productId: targetInventory.product,
    dealerId: targetInventory.dealer,
    quantity: quantity,
    reserved: targetInventory.reserved,
    available: Math.max(0, (targetInventory.onHand || 0) - (targetInventory.reserved || 0) - (targetInventory.damaged || 0) - (targetInventory.blocked || 0)),
    sku: targetInventory.sku,
  };
};

/**
 * Release reserved inventory when order is cancelled
 * 
 * @param {string} inventoryId - InventoryItem ID to release from
 * @param {number} quantity - Quantity to release
 * @returns {Object} Updated inventory item with details
 * @throws {Error} If inventory not found or reserved quantity is insufficient
 */
export const releaseReservation = async ({ inventoryId, quantity }) => {
  if (!inventoryId) {
    throw new Error('inventoryId is required');
  }
  if (quantity < 1) {
    throw new Error('Quantity must be at least 1');
  }

  const inventory = await InventoryItem.findById(inventoryId);
  if (!inventory) {
    throw new Error(`Inventory item ${inventoryId} not found`);
  }

  const currentReserved = inventory.reserved || 0;
  if (currentReserved < quantity) {
    throw new Error(`Cannot release ${quantity} units. Only ${currentReserved} units are reserved`);
  }

  inventory.reserved = currentReserved - quantity;
  inventory.lastUpdatedAt = new Date();
  await inventory.save();

  const available = Math.max(0, (inventory.onHand || 0) - (inventory.reserved || 0) - (inventory.damaged || 0) - (inventory.blocked || 0));

  return {
    inventoryId: inventory._id,
    quantity: quantity,
    reserved: inventory.reserved,
    available,
    sku: inventory.sku,
  };
};

/**
 * Get current reservation status for a product from a specific dealer
 * 
 * @param {string} productId - Product ID
 * @param {string} dealerId - Dealer ID
 * @param {string} fulfillmentNodeId - (Optional) FulfillmentNode ID
 * @returns {Object} Inventory status with available/reserved details
 */
export const getInventoryStatus = async ({ productId, dealerId, fulfillmentNodeId = null }) => {
  const query = {
    product: productId,
    dealer: dealerId,
    isActive: true,
  };

  if (fulfillmentNodeId) {
    query.fulfillmentNode = fulfillmentNodeId;
  }

  const items = await InventoryItem.find(query).populate('fulfillmentNode', 'name');
  
  if (!items.length) {
    return {
      found: false,
      inventory: [],
    };
  }

  return {
    found: true,
    inventory: items.map((item) => ({
      inventoryId: item._id,
      fulfillmentNodeId: item.fulfillmentNode._id,
      fulfillmentNodeName: item.fulfillmentNode.name,
      onHand: item.onHand || 0,
      reserved: item.reserved || 0,
      damaged: item.damaged || 0,
      blocked: item.blocked || 0,
      available: Math.max(0, (item.onHand || 0) - (item.reserved || 0) - (item.damaged || 0) - (item.blocked || 0)),
      sku: item.sku,
    })),
  };
};

/**
 * Batch reserve inventory for multiple items
 * 
 * @param {Array} items - Array of { productId, dealerId, quantity, fulfillmentNodeId }
 * @returns {Array} Array of reservation results
 * @throws {Error} If any item fails to reserve (all-or-nothing transaction)
 */
export const reserveMultiple = async (items) => {
  const reservations = [];
  const reservedInventories = [];

  try {
    for (const item of items) {
      const reservation = await reserveInventory({
        productId: item.productId,
        dealerId: item.dealerId,
        quantity: item.quantity,
        fulfillmentNodeId: item.fulfillmentNodeId,
      });
      reservations.push(reservation);
      reservedInventories.push({
        inventoryId: reservation.inventoryId,
        quantity: item.quantity,
      });
    }
    return reservations;
  } catch (err) {
    // Rollback on failure: release all previously reserved items
    for (const reserved of reservedInventories) {
      try {
        await releaseReservation({
          inventoryId: reserved.inventoryId,
          quantity: reserved.quantity,
        });
      } catch (rollbackErr) {
        console.error('Rollback failed for inventory', reserved.inventoryId, rollbackErr.message);
      }
    }
    throw new Error(`Batch reservation failed: ${err.message}`);
  }
};

export default {
  reserveInventory,
  releaseReservation,
  getInventoryStatus,
  reserveMultiple,
};
