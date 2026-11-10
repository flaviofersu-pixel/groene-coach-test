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

const DAY_MS = 86_400_000;

/**
 * ISO date -> plain Dutch: "vandaag", "gisteren", "5 dagen geleden",
 * "3 weken geleden", "4 maanden geleden", "2 jaar geleden".
 * @param {string} iso
 * @param {number} [now] current time in ms (tests pass a fixed value)
 */
export function formatRelative(iso, now = Date.now()) {
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (days <= 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  if (days < 14) return `${days} dagen geleden`;
  if (days < 60) return `${Math.floor(days / 7)} weken geleden`;
  if (days < 365) return `${Math.floor(days / 30)} maanden geleden`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1 jaar geleden' : `${years} jaar geleden`;
}

/**
 * "Laatst bewerkt 2 jaar geleden". Deliberately "bewerkt", not "geopend":
 * Microsoft 365 only reliably knows when a file was last CHANGED
 * (lastModifiedDateTime), not when someone last opened it.
 */
export const lastEditedLabel = (iso, now) => `Laatst bewerkt ${formatRelative(iso, now)}`;

/** "1 bestand" / "3 bestanden" */
export const plural = (n, one, many) => `${formatNumber(n, 0)} ${n === 1 ? one : many}`;

/**
 * Plain greeting based on the time of day (browser clock, no data involved):
 * "Goedemorgen" until 12:00, "Goedemiddag" until 18:00, otherwise "Goedenavond".
 * @param {Date} date
 */
export function greetingFor(date) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 12) return 'Goedemorgen';
  if (hour >= 12 && hour < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

/** First name for the greeting. */
export const firstName = (displayName) => displayName.split(' ')[0];
