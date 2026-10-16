/**
 * Address → coordinates (geocoding).
 *
 * Uses OpenStreetMap Nominatim by default (free, no API key). Swap the
 * provider here later (Google / MapmyIndia / Mapbox) without touching any
 * caller — everything else only uses geocodeAddress().
 *
 * Nominatim usage policy: max 1 request/second and a real User-Agent.
 * Results are persisted on the customer's address (see
 * customerLocationService), so each address is geocoded only once.
 *
 * Optional env vars:
 *   GEOCODER_URL         default https://nominatim.openstreetmap.org/search
 *   GEOCODER_USER_AGENT  default ecommerce-fulfillment/1.0 (set your own contact!)
 */
const GEOCODER_URL = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = process.env.GEOCODER_USER_AGENT || 'ecommerce-fulfillment/1.0';
const TIMEOUT_MS = 6000;

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const join = (...parts) => parts.filter(Boolean).join(', ');

/** Most specific query first, then progressively coarser fallbacks. */
const buildQueries = (address = {}) => {
  const street = clean(address.street);
  const city = clean(address.city);
  const state = clean(address.state);
  const pincode = clean(address.pincode);
  const country = clean(address.country) || 'India';

  const queries = [];
  if (street && (city || pincode)) queries.push(join(street, city, state, pincode, country));
  if (pincode) queries.push(join(pincode, city, state, country));
  if (city) queries.push(join(city, state, country));
  return [...new Set(queries)];
};

const lookup = async (query, country) => {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q: query });
  if (/^india$/i.test(country)) params.set('countrycodes', 'in');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${GEOCODER_URL}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const rows = await response.json();
    const first = Array.isArray(rows) ? rows[0] : null;
    if (!first) return null;

    const latitude = Number(first.lat);
    const longitude = Number(first.lon);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    ) return null;

    return { latitude, longitude };
  } catch {
    return null; // timeout / network error → caller treats as "not found"
  } finally {
    clearTimeout(timer);
  }
};

/**
 * geocodeAddress({ street, city, state, pincode, country })
 * → { latitude, longitude } or null when the address cannot be located.
 * Never throws.
 */
export const geocodeAddress = async (address) => {
  const country = clean(address?.country) || 'India';
  for (const query of buildQueries(address)) {
    const found = await lookup(query, country);
    if (found) return found;
  }
  return null;
};

export default { geocodeAddress };