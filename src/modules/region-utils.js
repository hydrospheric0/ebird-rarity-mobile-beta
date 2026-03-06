/**
 * Region data and pure utility functions for region/string handling.
 * Supports US (state→county hierarchy) and international regions where
 * the subnational-1 level (ISO 3166-2) is the finest boundary available.
 * No external imports, no side-effects.
 */

export const US_REGION_CODE = 'US'

/**
 * Countries where subnational-1 boundaries (ISO 3166-2) are the leaf
 * boundary level supported by the app — there is no sub-county tier.
 * For these countries a two-segment code like "NL-GR" is treated as
 * the "county" equivalent and the bare country code ("NL") as the
 * "state" equivalent.
 */
export const LEAF_SUBNATIONAL1_COUNTRIES = new Set(['NL'])

/**
 * All supported US states + DC (includes AK and HI).
 * Used for the state picker, search region select, and state-level rarity fetches.
 */
export const ALL_STATES = [
  { code: 'US-AK', name: 'Alaska' },
  { code: 'US-AL', name: 'Alabama' },
  { code: 'US-AZ', name: 'Arizona' },
  { code: 'US-AR', name: 'Arkansas' },
  { code: 'US-CA', name: 'California' },
  { code: 'US-CO', name: 'Colorado' },
  { code: 'US-CT', name: 'Connecticut' },
  { code: 'US-DC', name: 'District of Columbia' },
  { code: 'US-DE', name: 'Delaware' },
  { code: 'US-FL', name: 'Florida' },
  { code: 'US-GA', name: 'Georgia' },
  { code: 'US-HI', name: 'Hawaii' },
  { code: 'US-ID', name: 'Idaho' },
  { code: 'US-IL', name: 'Illinois' },
  { code: 'US-IN', name: 'Indiana' },
  { code: 'US-IA', name: 'Iowa' },
  { code: 'US-KS', name: 'Kansas' },
  { code: 'US-KY', name: 'Kentucky' },
  { code: 'US-LA', name: 'Louisiana' },
  { code: 'US-ME', name: 'Maine' },
  { code: 'US-MD', name: 'Maryland' },
  { code: 'US-MA', name: 'Massachusetts' },
  { code: 'US-MI', name: 'Michigan' },
  { code: 'US-MN', name: 'Minnesota' },
  { code: 'US-MS', name: 'Mississippi' },
  { code: 'US-MO', name: 'Missouri' },
  { code: 'US-MT', name: 'Montana' },
  { code: 'US-NE', name: 'Nebraska' },
  { code: 'US-NV', name: 'Nevada' },
  { code: 'US-NH', name: 'New Hampshire' },
  { code: 'US-NJ', name: 'New Jersey' },
  { code: 'US-NM', name: 'New Mexico' },
  { code: 'US-NY', name: 'New York' },
  { code: 'US-NC', name: 'North Carolina' },
  { code: 'US-ND', name: 'North Dakota' },
  { code: 'US-OH', name: 'Ohio' },
  { code: 'US-OK', name: 'Oklahoma' },
  { code: 'US-OR', name: 'Oregon' },
  { code: 'US-PA', name: 'Pennsylvania' },
  { code: 'US-RI', name: 'Rhode Island' },
  { code: 'US-SC', name: 'South Carolina' },
  { code: 'US-SD', name: 'South Dakota' },
  { code: 'US-TN', name: 'Tennessee' },
  { code: 'US-TX', name: 'Texas' },
  { code: 'US-UT', name: 'Utah' },
  { code: 'US-VT', name: 'Vermont' },
  { code: 'US-VA', name: 'Virginia' },
  { code: 'US-WA', name: 'Washington' },
  { code: 'US-WV', name: 'West Virginia' },
  { code: 'US-WI', name: 'Wisconsin' },
  { code: 'US-WY', name: 'Wyoming' },
]

/**
 * @deprecated Use ALL_STATES — kept for incremental migration.
 * Previously named LOWER_48_STATES but was already missing AK/HI/DC.
 */
export const LOWER_48_STATES = ALL_STATES

/**
 * All supported regions at the "state" level, including international
 * country entries. Each entry's `code` is the key used to load the
 * corresponding boundary file (public/data/counties/${code}.json).
 */
export const ALL_REGIONS = [
  ...ALL_STATES,
  { code: 'NL', name: 'Netherlands' },
]

/**
 * Approximate geographic centroids used for state-level map markers.
 * Includes AK, HI, and DC.
 */
export const STATE_CENTERS = new Map([
  ['US-AK', { lat: 64.2, lng: -153.0 }],
  ['US-AL', { lat: 32.8, lng: -86.8 }],
  ['US-AZ', { lat: 34.3, lng: -111.1 }],
  ['US-AR', { lat: 35.0, lng: -92.4 }],
  ['US-CA', { lat: 37.2, lng: -119.5 }],
  ['US-CO', { lat: 39.0, lng: -105.5 }],
  ['US-CT', { lat: 41.6, lng: -72.7 }],
  ['US-DC', { lat: 38.9, lng: -77.0 }],
  ['US-DE', { lat: 39.0, lng: -75.5 }],
  ['US-FL', { lat: 28.1, lng: -82.4 }],
  ['US-GA', { lat: 32.7, lng: -83.4 }],
  ['US-HI', { lat: 20.5, lng: -157.0 }],
  ['US-ID', { lat: 44.4, lng: -114.6 }],
  ['US-IL', { lat: 40.0, lng: -89.2 }],
  ['US-IN', { lat: 40.3, lng: -86.1 }],
  ['US-IA', { lat: 42.1, lng: -93.5 }],
  ['US-KS', { lat: 38.5, lng: -98.4 }],
  ['US-KY', { lat: 37.5, lng: -85.3 }],
  ['US-LA', { lat: 31.1, lng: -91.9 }],
  ['US-ME', { lat: 45.4, lng: -69.2 }],
  ['US-MD', { lat: 39.1, lng: -76.8 }],
  ['US-MA', { lat: 42.3, lng: -71.8 }],
  ['US-MI', { lat: 44.3, lng: -85.4 }],
  ['US-MN', { lat: 46.4, lng: -94.0 }],
  ['US-MS', { lat: 32.7, lng: -89.7 }],
  ['US-MO', { lat: 38.5, lng: -92.5 }],
  ['US-MT', { lat: 47.0, lng: -110.0 }],
  ['US-NE', { lat: 41.5, lng: -99.9 }],
  ['US-NV', { lat: 39.3, lng: -116.6 }],
  ['US-NH', { lat: 43.7, lng: -71.6 }],
  ['US-NJ', { lat: 40.1, lng: -74.5 }],
  ['US-NM', { lat: 34.5, lng: -106.1 }],
  ['US-NY', { lat: 42.9, lng: -75.5 }],
  ['US-NC', { lat: 35.6, lng: -79.4 }],
  ['US-ND', { lat: 47.5, lng: -100.5 }],
  ['US-OH', { lat: 40.4, lng: -82.7 }],
  ['US-OK', { lat: 35.6, lng: -97.5 }],
  ['US-OR', { lat: 44.1, lng: -120.5 }],
  ['US-PA', { lat: 40.9, lng: -77.8 }],
  ['US-RI', { lat: 41.7, lng: -71.5 }],
  ['US-SC', { lat: 33.9, lng: -80.9 }],
  ['US-SD', { lat: 44.4, lng: -100.3 }],
  ['US-TN', { lat: 35.9, lng: -86.4 }],
  ['US-TX', { lat: 31.5, lng: -99.3 }],
  ['US-UT', { lat: 39.4, lng: -111.1 }],
  ['US-VT', { lat: 44.0, lng: -72.7 }],
  ['US-VA', { lat: 37.9, lng: -79.5 }],
  ['US-WA', { lat: 47.4, lng: -120.5 }],
  ['US-WV', { lat: 38.6, lng: -80.6 }],
  ['US-WI', { lat: 44.6, lng: -90.0 }],
  ['US-WY', { lat: 43.0, lng: -107.5 }],
  // International
  ['NL',    { lat: 52.3, lng:    5.3 }],
])

// ---------------------------------------------------------------------------
// Region-code utilities
// ---------------------------------------------------------------------------

/**
 * Returns true for state-level region codes: US states ("US-CA") and
 * LEAF_SUBNATIONAL1_COUNTRIES country codes ("NL").
 * Returns false for the national US code and for county-level codes.
 */
export function isStateRegionCode(region) {
  const r = String(region || '').toUpperCase()
  if (/^US-[A-Z]{2,3}$/.test(r)) return true
  if (LEAF_SUBNATIONAL1_COUNTRIES.has(r)) return true
  return false
}

/**
 * Returns true for county-level region codes:
 *   US counties like "US-CA-113"
 *   Subnational-1 codes for LEAF_SUBNATIONAL1_COUNTRIES like "NL-GR"
 */
export function isCountyRegionCode(region) {
  const r = String(region || '').toUpperCase()
  if (/^US-[A-Z]{2,3}-\d{3}$/.test(r)) return true
  const parts = r.split('-')
  if (parts.length === 2 && LEAF_SUBNATIONAL1_COUNTRIES.has(parts[0])) return true
  return false
}

/**
 * Extract the state region (e.g. "US-CA") from a county region code.
 * Returns null if not a valid county code.
 */
export function stateRegionFromCountyRegion(countyRegion) {
  const r = String(countyRegion || '').toUpperCase()
  if (/^US-[A-Z]{2,3}-\d{3}$/.test(r)) return r.slice(0, 5)          // "US-CA-113" → "US-CA"
  const parts = r.split('-')
  if (parts.length === 2 && LEAF_SUBNATIONAL1_COUNTRIES.has(parts[0])) return parts[0]  // "NL-GR" → "NL"
  return null
}

/**
 * Normalise any supported region code to a state-level region.
 * Returns US_REGION_CODE for "US", the code itself for state codes,
 * and the parent state for county codes.  Returns null for unrecognised input.
 */
export function stateRegionFromAnyRegion(regionCode) {
  const normalized = String(regionCode || '').toUpperCase()
  if (normalized === US_REGION_CODE) return US_REGION_CODE
  if (/^US-[A-Z]{2,3}$/.test(normalized)) return normalized
  if (/^US-[A-Z]{2,3}-\d{3}$/.test(normalized)) return stateRegionFromCountyRegion(normalized)
  // LEAF countries: country code IS the state level
  if (LEAF_SUBNATIONAL1_COUNTRIES.has(normalized)) return normalized
  // LEAF subnational1 codes: "NL-GR" → "NL"
  const parts = normalized.split('-')
  if (parts.length === 2 && LEAF_SUBNATIONAL1_COUNTRIES.has(parts[0])) return parts[0]
  return null
}

/** Human-readable state name from a state region code (e.g. "US-CA" → "California"). */
export function getStateNameByRegion(stateRegion) {
  const normalizedState = String(stateRegion || '').toUpperCase()
  const found = ALL_REGIONS.find((r) => r.code === normalizedState)
  return found?.name || normalizedState
}

/** Two-letter abbreviation from a region code (e.g. "US-CA" → "CA", "US" → "US"). */
export function getStateAbbrevByRegion(regionCode) {
  const normalized = String(regionCode || '').toUpperCase()
  if (normalized === US_REGION_CODE) return 'US'
  if (/^US-[A-Z]{2}$/.test(normalized)) return normalized.split('-')[1] || normalized
  return normalized
}

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

/** Normalise a county name to a compact lowercase token for fuzzy matching. */
export function normalizeCountyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(county|parish|borough|census area)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Strip common suffixes ("County", "Parish", "Borough", "City and Borough") from a county display name. */
export function shortCountyName(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw
    .replace(/\s+(County|Parish|Borough|Census Area)$/i, '')
    .replace(/\s+City and Borough$/i, '')
    .replace(/\s+City$/i, '')
    .trim()
}

/** Escape a string for safe insertion into HTML. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
