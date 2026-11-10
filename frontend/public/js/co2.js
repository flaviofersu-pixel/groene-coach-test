/**
 * @file co2.js
 * @description Shows a CO2 amount the same way everywhere.
 *
 * Rules (from the user review, to keep the screens calm):
 *  - CO2 is only shown on TOTALS; a single file shows its size in MB instead.
 *  - The everyday example ("≈ 2 – 5 keer je telefoon opladen") appears ONCE per
 *    screen, on the main total, via `{ example: true }`. Below one charge the API
 *    sends no example at all, and then nothing is shown.
 *  - At most one "i" button per card: amounts have none by default; a card adds
 *    one with co2InfoButton().
 * The numbers in the explanation come from the live table of calculation factors.
 */

import { api } from './api.js';
import { el, append, infoButton } from './dom.js';
import { formatNumber } from './format.js';

/** Calculation factors by key, filled once by loadCo2Factors(). */
let factors = {};

/** Loads the calculation factors (public endpoint, no personal data). Call once at start-up. */
export async function loadCo2Factors() {
  try {
    const { metrics } = await api.metrics();
    factors = Object.fromEntries(metrics.map((m) => [m.key, m]));
  } catch {
    factors = {}; // the explanation then simply leaves out the numbers
  }
}

/** "0,014 – 0,024 kWh" for one factor, or '' when the factors are not loaded. */
function factorRange(key) {
  const f = factors[key];
  if (!f) return '';
  return f.value_low === f.value_high
    ? `${formatNumber(f.value_low, 3)} ${f.unit}`
    : `${formatNumber(f.value_low, 3)} – ${formatNumber(f.value_high, 3)} ${f.unit}`;
}

/** The "how do we calculate this" explanation shown in the popover. */
export function co2Explanation() {
  const grid = factors.grid_emission_factor;
  const phone = factors.phone_charge_kwh;
  return [
    el('p', 'info-title', 'Hoe rekenen we?'),
    el('p', '', 'We schatten hoeveel stroom het scheelt in het datacenter en op het netwerk als een bestand op de juiste plek staat. ' +
      `Die stroom rekenen we om naar CO₂ met ${grid ? `${formatNumber(grid.value_low, 0)} gram CO₂ per kWh` : 'de Nederlandse stroommix'}.`),
    el('p', '', 'Het is een schatting, daarom tonen we een onder- en bovengrens.'),
    el('p', '', `Je telefoon een keer opladen kost ${factorRange('phone_charge_kwh') || 'een kleine hoeveelheid stroom'}. ` +
      'Is de besparing minder dan een keer opladen, dan laten we het voorbeeld weg.'),
    phone ? el('p', 'info-source', `Bron: ${phone.source}.`) : null,
  ].filter(Boolean);
}

/** The "i" button with the explanation; use at most one per card. */
export function co2InfoButton() {
  return infoButton('Uitleg over de CO₂-berekening', () => co2Explanation());
}

/**
 * The everyday example as a green label, e.g. [≈ 1 – 4 keer je telefoon opladen].
 * @param {{ label: string } | null} equivalent
 * @returns {HTMLElement | null} null when there is no example (less than one charge)
 */
export function co2Example(equivalent) {
  if (!equivalent) return null;
  return append(el('span', 'co2-eq'), el('span', '', `≈ ${equivalent.label}`));
}

/**
 * A CO2 total.
 * @param {{ label: string, equivalent?: { label: string } | null }} co2 a `co2_per_year` object from the API
 * @param {{ suffix?: string, info?: boolean, stacked?: boolean, example?: boolean }} [options]
 *   suffix  text after the amount (default " per jaar")
 *   info    add the "i" button (default false: at most one per card)
 *   stacked put the example on its own line
 *   example show the everyday example (default false: only on the main total of a screen)
 */
export function co2Amount(co2, { suffix = ' per jaar', info = false, stacked = false, example = false } = {}) {
  const amount = el('span', `co2${stacked ? ' co2--stacked' : ''}`);
  append(amount, el('strong', 'co2-value', `${co2.label}${suffix}`));
  if (info) amount.append(co2InfoButton());
  if (example) append(amount, co2Example(co2.equivalent));
  return amount;
}

/** Plain-text version for tooltips and aria-labels (never with the example). */
export const co2Text = (co2, suffix = ' per jaar') => `${co2.label}${suffix}`;
