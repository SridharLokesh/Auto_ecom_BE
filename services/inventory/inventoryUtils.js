/**
 * Shared inventory helpers.
 *
 * `available` is never stored as an independent editable number — it is
 * always derived:
 *
 *   available = onHand - reserved - damaged - blocked
 *
 * Mongoose virtuals cover non-lean documents; these helpers cover lean
 * query results / plain objects.
 */

export const computeAvailable = (item) =>
  Math.max(
    0,
    (item?.onHand || 0) -
      (item?.reserved || 0) -
      (item?.damaged || 0) -
      (item?.blocked || 0)
  );

/** Attach `available` to a single lean doc / plain object. */
export const withAvailable = (item) =>
  item ? { ...item, available: computeAvailable(item) } : item;

/** Attach `available` to an array of lean docs. */
export const withAvailableList = (items) =>
  Array.isArray(items) ? items.map(withAvailable) : [];

/** Normalise a MongoDB id filter (validates + converts). Returns null when invalid. */
export const optionalIdFilter = (value) =>
  value && /^[0-9a-fA-F]{24}$/.test(String(value).trim())
    ? String(value).trim()
    : null;