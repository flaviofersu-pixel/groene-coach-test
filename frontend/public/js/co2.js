/**
 * @file co2.js
 * @description Shows a CO2 amount the same way everywhere:
 *
 *    3 – 5 gram CO₂ per jaar  ≈ 1 – 4 keer je telefoon opladen  (i)
 *
 * The band and the everyday example both come ready-made from the API
 * (`co2_per_year.label` and `co2_per_year.equivalent.label`). The longer
 * explanation sits behind the small "i" button, so the screens stay short.
 * The numbers in that explanation come from the live `co2_metrics` table.
 */

import { api } from './api.js';
import { el, append, infoButton } from './dom.js';
import { formatNumber } from './format.js';

/** co2_metrics rows by key, filled once by loadCo2Factors(). */
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

/** Explanation paragraph for one kind of everyday example. */
function exampleExplanation(kind) {
  const key = kind === 'kettle' ? 'kettle_litre_kwh' : 'phone_charge_kwh';
  const f = factors[key];
  const what = kind === 'kettle' ? '1 liter water koken in een waterkoker' : 'je telefoon een keer helemaal opladen';
  return append(el('div'),
    el('p', '', `Het voorbeeld: ${what} kost ${factorRange(key) || 'een kleine hoeveelheid stroom'}. ` +
      'We kiezen bewust een klein voorbeeld, omdat de besparing van een persoon ook klein is.'),
    f ? el('p', 'info-source', `Bron: ${f.source}.`) : null);
}

/** The full "how do we calculate this" explanation shown in the popover. */
export function co2Explanation(kind = 'phone') {
  const grid = factors.grid_emission_factor;
  return [
    el('p', 'info-title', 'Hoe rekenen we?'),
    el('p', '', 'We schatten hoeveel stroom het scheelt in het datacenter en op het netwerk als een bestand op de juiste plek staat. ' +
      `Die stroom rekenen we om naar CO₂ met ${grid ? `${formatNumber(grid.value_low, 0)} gram CO₂ per kWh` : 'de Nederlandse stroommix'}.`),
    el('p', '', 'Omdat dit een schatting is, tonen we altijd een bandbreedte: van … tot …'),
    exampleExplanation(kind),
    el('p', 'info-source', 'Alle factoren staan in het tabblad "Privacy & berekening".'),
  ];
}

/** Just the "i" button with the explanation, e.g. for a panel header. */
export function co2InfoButton(kind = 'phone') {
  return infoButton('Uitleg over de CO₂-berekening', () => co2Explanation(kind));
}

/**
 * A CO2 amount with its everyday example (and optionally the "i" button).
 * @param {{ label: string, equivalent?: { kind: string, label: string } }} co2 a `co2_per_year` object from the API
 * @param {{ suffix?: string, info?: boolean, stacked?: boolean }} [options]
 *   suffix  text after the amount (default " per jaar")
 *   info    show the "i" button (default true)
 *   stacked put the example on its own line (for narrow list columns)
 */
export function co2Amount(co2, { suffix = ' per jaar', info = true, stacked = false } = {}) {
  const amount = el('span', `co2${stacked ? ' co2--stacked' : ''}`);
  append(amount, el('strong', 'co2-value', `${co2.label}${suffix}`));
  if (info) amount.append(co2InfoButton(co2.equivalent?.kind));
  if (co2.equivalent) amount.append(co2Example(co2.equivalent));
  return amount;
}


/**
 * The everyday example as a clearly visible green label, e.g.
 *   [ ≈ 1 – 4 keer je telefoon opladen]
 * Always shown on screen, so nobody has to open the "i" to see what it means.
 * @param {{ kind: string, label: string }} equivalent
 */
export function co2Example(equivalent) {
  return append(el('span', 'co2-eq'), el('span', '', `≈ ${equivalent.label}`));
}

/** Plain-text version for toasts, tooltips and aria-labels. */
export const co2Text = (co2, suffix = ' per jaar') =>
  `${co2.label}${suffix}${co2.equivalent ? ` (≈ ${co2.equivalent.label})` : ''}`;
