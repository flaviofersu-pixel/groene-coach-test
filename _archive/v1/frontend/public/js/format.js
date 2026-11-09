/**
 * @file format.js
 * @description Dutch (nl-NL) number and unit formatting helpers. Units scale
 * automatically so a tiny saving never reads as "0" (encouraging copy).
 */

const nf = (maxDecimals) => new Intl.NumberFormat('nl-NL', { maximumFractionDigits: maxDecimals });

/** 1234.5 -> "1.234,5" */
export const formatNumber = (n, maxDecimals = 1) => nf(maxDecimals).format(n);

/** Grams CO2 -> "12,4 g" or "1,25 kg". */
export function formatCo2(grams) {
  if (grams >= 1000) return `${formatNumber(grams / 1000, 2)} kg`;
  return `${formatNumber(grams, grams < 10 ? 2 : 1)} g`;
}

/** Megabytes -> "850 MB" or "1,4 GB". */
export function formatSize(mb) {
  if (mb >= 1024) return `${formatNumber(mb / 1024, 1)} GB`;
  return `${formatNumber(mb, 1)} MB`;
}

/** Duration in hours -> "35 minuten" / "4,2 uur" / "3,1 dagen". */
export function formatDuration(hours) {
  if (hours < 1) return `${formatNumber(hours * 60, 0)} minuten`;
  if (hours < 48) return `${formatNumber(hours, 1)} uur`;
  return `${formatNumber(hours / 24, 1)} dagen`;
}

/** Distance in km -> "850 meter" / "3,4 km". */
export function formatDistance(km) {
  return km < 1 ? `${formatNumber(km * 1000, 0)} meter` : `${formatNumber(km, 1)} km`;
}

/** ISO date -> "3 nov. 2026". */
export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });

/** Days since last access -> "vandaag" / "gisteren" / "12 dagen geleden". */
export function formatDaysAgo(days) {
  if (days <= 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  return `${days} dagen geleden`;
}
