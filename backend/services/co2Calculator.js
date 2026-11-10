/**
 * @file co2Calculator.js
 * @description The compliant ("honest") Green IT calculation engine.
 *
 * DESIGN PATTERN: pure functions. Nothing in this module touches the database,
 * the clock (callers pass `now`) or the network. Coefficients are injected as
 * an object built from the `co2_metrics` table, so the model is auditable,
 * unit-testable and recalibratable without code changes.
 *
 * HONESTY RULES (from the architecture review)
 *  1. Every coefficient is a BAND (low..high); every result is a band. The UI
 *     shows "3 – 5 gram CO2", never a falsely precise "4.12 gram".
 *  2. A single OneDrive -> SharePoint move frees 0 bytes of storage: the same
 *     bytes simply live somewhere else. It only saves SYNC TRAFFIC and BACKUP
 *     OVERHEAD. Storage savings exist only when a duplicate chain is broken.
 *  3. E-mail attachments are cloned into every recipient's mailbox (the "Rick
 *     van Kersbergen rule": 1 attachment to 20 people = 20x storage).
 *
 * UNITS: 1 GB = 1024 MB (as OneDrive displays sizes); 1 TB = 1000 GB for the
 * W/TB power coefficient (as hardware vendors specify it).
 */

export const HOURS_PER_YEAR = 8760;
export const MB_PER_GB = 1024;
const GB_PER_TB = 1000;
const WH_PER_KWH = 1000;

/** Coefficient keys the engine needs; loading fails loudly if one is missing. */
export const REQUIRED_COEFFICIENTS = Object.freeze([
  'grid_emission_factor', 'storage_power_w_per_tb', 'pue', 'storage_replication_factor',
  'network_energy_kwh_per_gb', 'edit_cycles_active', 'edit_cycles_dormant', 'active_window_days',
  'delta_sync_reduction', 'backup_dedup_reduction', 'mail_copies_per_recipient', 'phone_charge_kwh',
]);

// --- Band arithmetic -----------------------------------------------------------------
// All inputs are non-negative, so low x low and high x high give the bounds.

/** @typedef {{ low: number, high: number }} Band */

/** @returns {Band} */
export const band = (low, high = low) => ({ low, high });
const ZERO = Object.freeze(band(0));
/** Sum of bands. */
export const addBands = (...bands) => band(
  bands.reduce((s, b) => s + b.low, 0),
  bands.reduce((s, b) => s + b.high, 0)
);
/** Product of a band with a band or a plain number. */
export const mulBand = (a, b) => (typeof b === 'number'
  ? band(a.low * b, a.high * b)
  : band(a.low * b.low, a.high * b.high));

// --- Coefficients ----------------------------------------------------------------------

/**
 * Converts `co2_metrics` rows into a frozen { key: Band } lookup.
 * @param {{ key: string, value_low: number, value_high: number }[]} rows
 * @returns {Readonly<Record<string, Band>>}
 */
export function coefficientsFromRows(rows) {
  const c = {};
  for (const r of rows) c[r.key] = Object.freeze(band(r.value_low, r.value_high));
  const missing = REQUIRED_COEFFICIENTS.filter((k) => !(k in c));
  if (missing.length) throw new Error(`co2_metrics is missing: ${missing.join(', ')}`);
  return Object.freeze(c);
}

/**
 * Data-centre energy to keep 1 GB stored for one year (incl. cooling via PUE):
 *   0.65 W/TB x 8760 h / 1000 GB/TB / 1000 Wh/kWh x PUE 1.185 x replicas
 * = 0.006747 kWh per replica -> band over the replication factor.
 * @returns {Band} kWh per GB per year
 */
export function storageKwhPerGbYear(c) {
  const perReplica = (c.storage_power_w_per_tb.low * HOURS_PER_YEAR) / GB_PER_TB / WH_PER_KWH * c.pue.low;
  return mulBand(c.storage_replication_factor, perReplica);
}

/** Grams CO2 to store 1 GB for a year (≈ 1.8 – 3.6 g with the default coefficients). */
export const storageGramsPerGbYear = (c) => mulBand(storageKwhPerGbYear(c), c.grid_emission_factor.low);

/** Grams CO2 to move 1 GB over the network (sync overhead). */
export const networkGramsPerGb = (c) => mulBand(c.network_energy_kwh_per_gb, c.grid_emission_factor.low);

// --- Activity ----------------------------------------------------------------------------

/**
 * Files edited recently generate sync and backup traffic; dormant files hardly do.
 * @param {string} lastModifiedIso
 * @param {Date} now
 * @returns {'active'|'dormant'}
 */
export function classifyActivity(lastModifiedIso, now, c) {
  const days = (now.getTime() - Date.parse(lastModifiedIso)) / 86_400_000;
  return days <= c.active_window_days.low ? 'active' : 'dormant';
}

/** Turns energy (kWh band) into grams CO2. */
const toGrams = (kwh, c) => mulBand(kwh, c.grid_emission_factor.low);

// --- Scenario 1: move one file OneDrive -> SharePoint ---------------------------------------

/**
 * Yearly savings of moving ONE file from OneDrive to SharePoint.
 *
 *   sync_saved_GB   = size_GB x times_shared x edit_cycles x delta_sync_reduction
 *   backup_saved_GB = size_GB x edit_cycles x backup_dedup_reduction
 *   storage saved   = 0   (single move: same bytes, different place)
 *
 * Backup savings cost network energy (transfer to the vault) plus data-centre
 * energy (storing the backup copy for a year).
 *
 * @param {{ size_mb: number, times_shared: number, last_modified: string }} file
 * @param {Readonly<Record<string, Band>>} c
 * @param {Date} [now]
 */
export function estimateMigration(file, c, now = new Date()) {
  assertNonNegative(file.size_mb, 'size_mb');
  assertNonNegative(file.times_shared, 'times_shared');

  const sizeGb = file.size_mb / MB_PER_GB;
  const activity = classifyActivity(file.last_modified, now, c);
  const cycles = activity === 'active' ? c.edit_cycles_active : c.edit_cycles_dormant;

  // Sync: every collaborator's client re-syncs per edit; SharePoint delta-sync removes a share.
  const syncSavedGb = mulBand(mulBand(cycles, sizeGb * file.times_shared), c.delta_sync_reduction);
  const syncKwh = mulBand(syncSavedGb, c.network_energy_kwh_per_gb);

  // Backup: each saved version is processed; site-level backup deduplicates a share.
  const backupSavedGb = mulBand(mulBand(cycles, sizeGb), c.backup_dedup_reduction);
  const backupNetKwh = mulBand(backupSavedGb, c.network_energy_kwh_per_gb);
  const backupDcKwh = mulBand(backupSavedGb, storageKwhPerGbYear(c));
  const backupKwh = addBands(backupNetKwh, backupDcKwh);

  const totalKwh = addBands(syncKwh, backupKwh);
  return {
    activity,
    edit_cycles: cycles,
    storage: {
      freed_mb: 0,
      co2_g: ZERO,
      note: 'Een losse verhuizing bespaart geen opslag: dezelfde bytes staan nu op SharePoint.',
    },
    sync: { saved_gb: syncSavedGb, kwh: syncKwh, co2_g: toGrams(syncKwh, c) },
    backup: { saved_gb: backupSavedGb, kwh: backupKwh, dc_kwh: backupDcKwh, co2_g: toGrams(backupKwh, c) },
    total: { kwh: totalKwh, dc_kwh: backupDcKwh, co2_g: toGrams(totalKwh, c), storage_freed_mb: 0 },
  };
}

// --- Scenario 2: break a duplicate chain ------------------------------------------------------

/**
 * Yearly savings of removing redundant, bit-identical copies (the ONLY action
 * that frees storage). The copies go to the recycle bin, never hard-deleted.
 * @param {number} sizeMb size of one copy
 * @param {number} copiesRemoved
 */
export function estimateDuplicateRemoval(sizeMb, copiesRemoved, c) {
  assertNonNegative(sizeMb, 'sizeMb');
  assertNonNegative(copiesRemoved, 'copiesRemoved');
  const freedMb = sizeMb * copiesRemoved;
  const dcKwh = mulBand(storageKwhPerGbYear(c), freedMb / MB_PER_GB);
  return { total: { kwh: dcKwh, dc_kwh: dcKwh, co2_g: toGrams(dcKwh, c), storage_freed_mb: freedMb } };
}

// --- Scenario 3: e-mail attachment cloning ----------------------------------------------------

/**
 * The "Rick van Kersbergen rule": an attachment is stored once in EVERY
 * recipient's mailbox. 1 attachment to 20 people = 20x storage amplification.
 * Sharing a link instead stores 0 extra copies (the file already exists once).
 *
 * @param {{ sizeMb: number, recipients: number }} mail
 * @returns {{ copies: number, amplification: number, duplicate_mb: number,
 *            annual: { kwh: Band, dc_kwh: Band, co2_g: Band }, transfer: { kwh: Band, co2_g: Band } }}
 *   annual   = storing the clones for one year (recurring)
 *   transfer = delivering the clones once (one-off network energy)
 */
export function estimateAttachmentCloning({ sizeMb, recipients }, c) {
  assertNonNegative(sizeMb, 'sizeMb');
  if (!Number.isInteger(recipients) || recipients < 1) throw new RangeError('recipients must be a positive integer');

  const copies = recipients * c.mail_copies_per_recipient.low;
  const duplicateMb = sizeMb * copies;
  const duplicateGb = duplicateMb / MB_PER_GB;
  const dcKwh = mulBand(storageKwhPerGbYear(c), duplicateGb);
  const transferKwh = mulBand(c.network_energy_kwh_per_gb, duplicateGb);
  return {
    copies,
    amplification: copies,
    duplicate_mb: duplicateMb,
    annual: { kwh: dcKwh, dc_kwh: dcKwh, co2_g: toGrams(dcKwh, c) },
    transfer: { kwh: transferKwh, co2_g: toGrams(transferKwh, c) },
  };
}

/**
 * Cumulative waste of attachment cloning over historical mail metadata.
 * @param {{ size_mb: number, recipient_count: number }[]} rows
 */
export function cumulativeCloningWaste(rows, c) {
  let duplicateMb = 0;
  let recipients = 0;
  for (const r of rows) {
    duplicateMb += estimateAttachmentCloning({ sizeMb: r.size_mb, recipients: r.recipient_count }, c).duplicate_mb;
    recipients += r.recipient_count;
  }
  const dcKwh = mulBand(storageKwhPerGbYear(c), duplicateMb / MB_PER_GB);
  return {
    attachments: rows.length,
    recipients_total: recipients,
    average_amplification: rows.length ? recipients / rows.length : 0,
    duplicate_mb: duplicateMb,
    annual: { kwh: dcKwh, dc_kwh: dcKwh, co2_g: toGrams(dcKwh, c) },
  };
}

// --- Everyday example -----------------------------------------------------------------------

/**
 * The ONE everyday example used in the whole app: charging a phone.
 *
 * We compare ENERGY (kWh), not CO2: the phone uses the same electricity grid,
 * so the comparison holds whatever emission factor is used.
 * Bands stay honest: low = least energy ÷ most energy per charge, and
 * high = most energy ÷ least energy per charge.
 *
 * @param {Band} kwh
 * @returns {{ kind: 'phone', count: Band }}
 */
export function everydayEquivalent(kwh, c) {
  return { kind: 'phone', count: band(kwh.low / c.phone_charge_kwh.high, kwh.high / c.phone_charge_kwh.low) };
}

/**
 * Formats the everyday example, e.g. "2 – 5 keer je telefoon opladen".
 * Returns null when it would be less than one charge: "0,06 keer" or
 * "minder dan 1 keer" says nothing, so the UI then shows no example at all.
 * @param {{ kind: 'phone', count: Band }} eq
 * @returns {{ kind: string, low: number, high: number, label: string } | null}
 */
export function formatEquivalent(eq) {
  const { low, high, label } = formatBand(eq.count, 'count');
  if (high < 1) return null;
  const text = 'je telefoon opladen';
  if (low < 1) return { kind: eq.kind, low, high, label: `tot ${nl(high)} keer ${text}` }; // no fractions
  return { kind: eq.kind, low, high, label: `${label} keer ${text}` };
}

// --- Presentation: bandwidth ("bandbreedte") ---------------------------------------------------

/**
 * Rounds a value DOWN (lower bound) or UP (upper bound) to a "nice" step:
 * 1 significant digit below 10, 2 significant digits from 10 upwards.
 * Rounding outward keeps the band honest (it never shrinks).
 */
function niceRound(value, direction) {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = value < 10 ? magnitude : magnitude / 10;
  const n = direction === 'down' ? Math.floor(value / step + 1e-9) : Math.ceil(value / step - 1e-9);
  return Number((n * step).toPrecision(12));
}

const nl = (v) => new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 3 }).format(v);

/**
 * Formats a band for humans.
 * @param {Band} b
 * @param {'co2'|'kwh'|'count'} kind
 * @returns {{ low: number, high: number, label: string }}
 *   e.g. { low: 3, high: 5, label: '3 – 5 gram CO₂' }
 */
export function formatBand(b, kind = 'co2') {
  let { low, high } = b;
  let unit = { co2: 'gram CO₂', kwh: 'kWh', count: '' }[kind];
  if (kind === 'co2' && high >= 1000) { low /= 1000; high /= 1000; unit = 'kg CO₂'; }

  const lo = niceRound(low, 'down');
  const hi = niceRound(high, 'up');
  const suffix = unit ? ` ${unit}` : '';
  let label;
  if (hi === 0) label = `0${suffix}`;
  else if (lo === hi) label = `ca. ${nl(hi)}${suffix}`;
  else label = `${nl(lo)} – ${nl(hi)}${suffix}`;
  return { low: lo, high: hi, label };
}

function assertNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative number`);
}
