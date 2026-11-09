/**
 * @file format.js
 * @description Dutch (nl-NL) formatting helpers. CO2 figures arrive from the
 * API as ready-made bands ("3 – 5 gram CO₂"); these helpers cover sizes,
 * dates and counts.
 */

const nf = (maxDecimals) => new Intl.NumberFormat('nl-NL', { maximumFractionDigits: maxDecimals });

/** 1234.5 -> "1.234,5" */
export const formatNumber = (n, maxDecimals = 1) => nf(maxDecimals).format(n);

/** Megabytes -> "850 MB" or "1,4 GB". */
export function formatSize(mb) {
  if (mb >= 1024) return `${formatNumber(mb / 1024, 1)} GB`;
  return `${formatNumber(mb, mb < 10 ? 1 : 0)} MB`;
}

/** ISO date -> "3 nov. 2026". */
export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });

/** ISO date -> "vandaag" / "gisteren" / "12 dagen geleden". */
export function formatRelative(iso) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  if (days > 365) return 'meer dan een jaar geleden';
  return `${days} dagen geleden`;
}

/** "1 bestand" / "3 bestanden" */
export const plural = (n, one, many) => `${formatNumber(n, 0)} ${n === 1 ? one : many}`;

/** First name for the friendly nudge copy. */
export const firstName = (displayName) => displayName.split(' ')[0];
