/**
 * fulfillmentGroupService — Phase 5 (§13/§14)
 * ─────────────────────────────────────────────────────────────────────────
 * Groups a flat list of reserved order lines by fulfillment node. Exactly
 * one group per distinct node (§13), each preserving the correct dealer/
 * node/inventoryItem relationships straight from the source reservation
 * (§14) — never re-derived or guessed.
 */

/**
 * @param {Array} lines - [{ productId, dealerId, fulfillmentNodeId, nodeName,
 *   inventoryItemId, quantity, unitPrice, reservationId, dealerOfferId, sku, title, image }]
 * @returns {Array} groups - [{ fulfillmentNode, nodeName, dealer, items: [...], reservationIds: [...] }]
 */
export const groupLinesByFulfillmentNode = (lines) => {
  const groupsByNode = new Map();

  for (const line of lines) {
    const key = String(line.fulfillmentNodeId);
    if (!groupsByNode.has(key)) {
      groupsByNode.set(key, {
        fulfillmentNode: line.fulfillmentNodeId,
        nodeName: line.nodeName,
        dealer: line.dealerId,
        items: [],
        reservationIds: [],
      });
    }
    const group = groupsByNode.get(key);
    const lineTotal = line.unitPrice * line.quantity;
    group.items.push({
      product: line.productId,
      inventoryItem: line.inventoryItemId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal,
    });
    group.reservationIds.push(line.reservationId);
  }

  return [...groupsByNode.values()];
};

export default { groupLinesByFulfillmentNode };