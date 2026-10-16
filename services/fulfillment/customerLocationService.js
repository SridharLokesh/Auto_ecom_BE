import mongoose from 'mongoose';
import User from '../../models/User.js';
import { geocodeAddress } from '../../utils/geocode.js';

/**
 * Resolves WHERE the customer is, for fulfillment lookups.
 *
 * Accepts either
 *   • explicit { latitude, longitude }   (e.g. browser "current location"), or
 *   • { addressId }                      (one of the AUTHENTICATED user's saved addresses)
 *
 * For an address without stored coordinates, it is geocoded once and the
 * coordinates are saved back onto that address, so later requests are instant.
 * The address is always looked up under the authenticated user's own id —
 * a customer can never resolve (or probe) someone else's address.
 */
export class CustomerLocationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CustomerLocationError';
    this.code = code;
    this.status = status;
  }
}

const isBlank = (v) => v === undefined || v === null || v === '';
const isValidPair = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export const resolveCustomerLocation = async ({ userId, addressId, latitude, longitude }) => {
  // 1) Explicit coordinates win (browser "use my current location").
  if (!isBlank(latitude) || !isBlank(longitude)) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!isValidPair(lat, lng) || isBlank(latitude) || isBlank(longitude)) {
      throw new CustomerLocationError('INVALID_LOCATION', 'Valid latitude and longitude are required.', 400);
    }
    return { latitude: lat, longitude: lng, source: 'coordinates' };
  }

  // 2) Saved address.
  if (isBlank(addressId)) {
    throw new CustomerLocationError('INVALID_LOCATION', 'Valid latitude and longitude are required.', 400);
  }
  if (!mongoose.isValidObjectId(addressId)) {
    throw new CustomerLocationError('ADDRESS_NOT_FOUND', 'Selected address was not found.', 404);
  }

  const owner = await User.findOne(
    { _id: userId, 'addresses._id': addressId },
    { 'addresses.$': 1 },
  ).lean();
  const address = owner?.addresses?.[0];
  if (!address) {
    throw new CustomerLocationError('ADDRESS_NOT_FOUND', 'Selected address was not found.', 404);
  }

  // Already has stored coordinates (typeof check: null must not become 0).
  if (
    typeof address.latitude === 'number' && typeof address.longitude === 'number' &&
    isValidPair(address.latitude, address.longitude)
  ) {
    return { latitude: address.latitude, longitude: address.longitude, source: 'address' };
  }

  // Geocode once, then persist.
  const found = await geocodeAddress(address);
  if (!found) {
    throw new CustomerLocationError(
      'ADDRESS_LOCATION_UNAVAILABLE',
      "We couldn't locate this address. Please select a different address or use your current location.",
      422,
    );
  }

  User.updateOne(
    { _id: userId, 'addresses._id': addressId },
    { $set: { 'addresses.$.latitude': found.latitude, 'addresses.$.longitude': found.longitude } },
  ).catch((err) => console.warn('customerLocation: could not persist coordinates:', err.message));

  return { latitude: found.latitude, longitude: found.longitude, source: 'geocoded' };
};

export default { resolveCustomerLocation, CustomerLocationError };