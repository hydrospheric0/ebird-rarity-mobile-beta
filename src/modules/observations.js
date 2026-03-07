/**
 * Pure observation-processing utilities.
 * No DOM interactions, no module-level mutable state.
 */

import { getAbaCodeOverride } from '../data/species-reference.js'

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Returns the earliest Date that should be included for the given "days back"
 * window (today = day 1).
 */
export function cutoffDateForDaysBack(daysBack) {
  const days = Math.max(1, Number(daysBack) || 1)
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - (days - 1))
  return cutoff
}

/**
 * Parse an eBird observation date (YYYY-MM-DD or "YYYY-MM-DD HH:MM") into a
 * local Date, or return null on failure.
 *
 * eBird date-only strings are intentionally parsed as *local* midnight so that
 * day-based filtering works correctly regardless of the user's UTC offset.
 */
export function parseObsDate(obsDt) {
  if (!obsDt) return null
  if (obsDt instanceof Date) {
    return Number.isNaN(obsDt.getTime()) ? null : obsDt
  }
  const raw = String(obsDt).trim()
  if (!raw) return null

  const mDateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (mDateOnly) {
    const year = Number(mDateOnly[1])
    const month = Number(mDateOnly[2])
    const day = Number(mDateOnly[3])
    const d = new Date(year, month - 1, day)
    return Number.isNaN(d.getTime()) ? null : d
  }

  // Normalize "YYYY-MM-DD HH:MM" (Safari is picky about space-separated timestamps).
  const normalized = raw.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/,
    (_, date, time) => `${date}T${time}`
  )
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Try parsing multiple obs-date values in order; return the first that succeeds. */
export function parseFirstAvailableObsDate(...values) {
  for (const value of values) {
    const parsed = parseObsDate(value)
    if (parsed) return parsed
  }
  return null
}

/** Format a Date as "M/D" (no year). */
export function formatShortDate(date) {
  if (!date) return ''
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/** Format an eBird obs-date string as "M/D - h:mmam/pm". */
export function formatObsDateTime(obsDt) {
  const d = parseObsDate(obsDt)
  if (!d) return obsDt || 'Unknown date'
  const mo = d.getMonth() + 1
  const day = d.getDate()
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return `${mo}/${day} - ${h12}:${m}${ampm}`
}

/** Format an eBird obs-date string as "D/M - HH:MM" (24-hour). */
export function formatObsDayMonthTime24(obsDt) {
  const d = parseObsDate(obsDt)
  if (!d) return obsDt || 'Unknown date'
  const day = d.getDate()
  const mo = d.getMonth() + 1
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${mo} - ${h}:${m}`
}

/** Format a raw observation date value for display (full locale string). */
export function formatObservationDate(rawValue) {
  if (!rawValue) return '—'
  const parsed = new Date(rawValue)
  if (Number.isNaN(parsed.getTime())) return String(rawValue)
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/**
 * How many calendar days ago was `date` relative to today?
 * Returns null if date is invalid.
 */
export function dayOffsetFromToday(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - target.getTime()) / 86400000)
}

// ---------------------------------------------------------------------------
// ABA code helpers
// ---------------------------------------------------------------------------

/**
 * Extract the numeric ABA rarity code (1–5) from an observation object.
 * Falls back to the species-reference override table.
 * Returns null if no code can be determined.
 */
export function getAbaCodeNumber(item) {
  const rawCode = item?.abaCode ?? item?.abaRarityCode
  const code = Number(rawCode)
  if (Number.isFinite(code)) {
    const rounded = Math.round(code)
    if (rounded >= 1 && rounded <= 5) return rounded
    if (rounded === 6) return 5
  }
  const overrideCode = getAbaCodeOverride(
    item?.comName || item?.species || '',
    item?.speciesCode || item?.species_code || item?.speciesCode4 || ''
  )
  if (!Number.isFinite(Number(overrideCode))) return null
  const rounded = Math.round(Number(overrideCode))
  if (rounded >= 1 && rounded <= 5) return rounded
  if (rounded === 6) return 5
  return null
}

/**
 * Returns true if `item` passes the current ABA filter.
 * When `selectedCodes` is a non-empty Set, only items whose code is in the set
 * pass.  Otherwise ABA ≥ `abaMinValue` is required.
 */
export function matchesAbaSelection(item, abaMinValue, selectedCodes) {
  const code = getAbaCodeNumber(item)
  const selected = selectedCodes instanceof Set ? selectedCodes : new Set()
  const hasSelections = selected.size > 0
  if (hasSelections) {
    const codeIsNull = !Number.isFinite(code)
    if (codeIsNull) return selected.has(0)
    return selected.has(code)
  }
  const minCode = Math.max(1, Number(abaMinValue) || 1)
  if (!Number.isFinite(code)) return minCode <= 1
  return code >= minCode
}

// ---------------------------------------------------------------------------
// Observation filtering
// ---------------------------------------------------------------------------

/** Keep only observations whose subnational2Code matches `countyRegion`. */
export function filterObservationsToCountyRegion(observations, countyRegion) {
  const target = String(countyRegion || '').toUpperCase()
  const source = Array.isArray(observations) ? observations : []
  if (!target) return source
  return source.filter((item) => String(item?.subnational2Code || '').toUpperCase() === target)
}

/** Keep only observations whose subnational1Code matches `stateRegion`. */
export function filterObservationsToStateRegion(observations, stateRegion) {
  const target = String(stateRegion || '').toUpperCase()
  const source = Array.isArray(observations) ? observations : []
  if (!/^US-[A-Z]{2}$/.test(target)) return source
  return source.filter((item) => String(item?.subnational1Code || '').toUpperCase() === target)
}

// ---------------------------------------------------------------------------
// Observation aggregation / summarisation
// ---------------------------------------------------------------------------

/**
 * Summarise a flat observations array into unique species×location counts,
 * broken down by ABA code.
 */
export function summarizeCountyObservations(observations) {
  const grouped = new Map()
  ;(Array.isArray(observations) ? observations : []).forEach((item) => {
    const species = item?.comName || ''
    const state = String(item?.subnational1Code || '')
    const county = String(item?.subnational2Code || item?.subnational2Name || '')
    const lat = Number(item?.lat)
    const lng = Number(item?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const locId = item?.locId ? String(item.locId) : ''
    const locKey = locId || `${lat.toFixed(4)}|${lng.toFixed(4)}`
    const key = `${species}::${state}::${county}::${locKey}`
    const abaCode = getAbaCodeNumber(item)
    if (!grouped.has(key)) {
      grouped.set(key, { abaCode })
      return
    }
    const existing = grouped.get(key)
    if (abaCode > existing.abaCode) existing.abaCode = abaCode
  })

  const abaCounts = new Map([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])
  grouped.forEach((entry) => {
    const code = Number.isFinite(entry.abaCode) && entry.abaCode >= 1 && entry.abaCode <= 5 ? entry.abaCode : 0
    abaCounts.set(code, (abaCounts.get(code) || 0) + 1)
  })

  return { rarityCount: grouped.size, abaCounts }
}

/** Plain-text summary line for a county summary object. */
export function formatCountySummary(summary) {
  if (!summary) return 'Rarities: — · ABA: —'
  const parts = []
  for (let code = 1; code <= 5; code += 1) {
    const count = summary.abaCounts.get(code) || 0
    if (count > 0) parts.push(`${code}:${count}`)
  }
  const none = summary.abaCounts.get(0) || 0
  if (none > 0) parts.push(`0:${none}`)
  const abaText = parts.length ? parts.join(' ') : 'none'
  return `Rarities: ${summary.rarityCount} · ABA ${abaText}`
}

/** HTML pill-badge summary for a county summary object. */
export function formatCountySummaryPills(summary, options = {}) {
  if (!summary) return ''
  const { includeTotal = true, includeNoCode = false } = options || {}
  const pills = []
  if (includeTotal) {
    pills.push(`<span class="county-pill county-pill-rarity" title="Total rarities">${summary.rarityCount}</span>`)
  }
  for (let code = 1; code <= 5; code += 1) {
    const count = summary.abaCounts.get(code) || 0
    if (count > 0) {
      pills.push(`<span class="county-pill county-aba-pill aba-code-${code}" title="ABA ${code}: ${count}">${count}</span>`)
    }
  }
  if (includeNoCode) {
    const none = summary.abaCounts.get(0) || 0
    if (none > 0) {
      pills.push(`<span class="county-pill county-aba-pill aba-code-unknown" title="No ABA code: ${none}">${none}</span>`)
    }
  }
  return pills.join('')
}

// ---------------------------------------------------------------------------
// Observation metadata helpers
// ---------------------------------------------------------------------------

/** Returns true if the observation has been confirmed by both obsReviewed and obsValid. */
export function isConfirmedObservation(item) {
  if (item && typeof item.confirmedAny === 'boolean') return item.confirmedAny
  return Number(item?.obsReviewed) === 1 && Number(item?.obsValid) === 1
}

/** Two-letter state abbreviation extracted from subnational1Code. */
export function getItemStateAbbrev(item) {
  const code = String(item?.subnational1Code || '')
  if (!code) return ''
  return code.includes('-') ? (code.split('-').pop() || '') : code
}

/** County display name from subnational2Name or subnational2Code. */
export function getItemCountyName(item) {
  const county = String(item?.subnational2Name || item?.subnational2Code || '').trim()
  if (county) return county

  // LEAF countries (e.g. NL): province is stored at subnational1.*
  const stateCode = String(item?.subnational1Code || '').toUpperCase()
  if (stateCode.startsWith('NL-')) {
    const province = String(item?.subnational1Name || item?.subnational1Code || '').trim()
    if (province) return province
  }

  return ''
}

/** Composite group key: "species::state::county" (used for table row deduplication). */
export function getObservationGroupKey(item) {
  const species = item?.comName || ''
  const state = getItemStateAbbrev(item)
  const county = getItemCountyName(item)
  return `${species}::${state}::${county}`
}

// ---------------------------------------------------------------------------
// Location index (popup data)
// ---------------------------------------------------------------------------

/**
 * Stable location key for an observation: uses locId if present, otherwise
 * rounds lat/lng to 4 decimal places.
 */
export function getLocationKeyForItem(item) {
  const lat = Number(item?.lat)
  const lng = Number(item?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  const locId = item?.locId ? String(item.locId) : ''
  return locId || `${lat.toFixed(4)}|${lng.toFixed(4)}`
}

/**
 * Build a Map<locKey, [{species, abaCode, obsDt, subId}]> for use in
 * observation popup rendering.
 */
export function buildLocationIndexForPopup(observations) {
  const idx = new Map()
  const source = Array.isArray(observations) ? observations : []
  for (const item of source) {
    const key = getLocationKeyForItem(item)
    if (!key) continue
    if (!idx.has(key)) idx.set(key, { seen: new Set(), items: [] })
    const bucket = idx.get(key)

    const species = String(item?.comName || 'Unknown species')
    const code = getAbaCodeNumber(item)
    const obsDtRaw = item?.obsDt ? String(item.obsDt) : ''
    const subId = item?.subId ? String(item.subId) : ''
    const uniq = `${species}|${subId}|${obsDtRaw}`
    if (bucket.seen.has(uniq)) continue
    bucket.seen.add(uniq)
    bucket.items.push({
      species,
      abaCode: code,
      obsDt: obsDtRaw || null,
      subId: subId || null,
    })
  }

  const out = new Map()
  idx.forEach((bucket, key) => out.set(key, Array.isArray(bucket?.items) ? bucket.items : []))
  return out
}
