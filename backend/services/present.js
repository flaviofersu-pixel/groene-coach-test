/**
 * @file present.js
 * @description Presentation helpers: turn raw engine bands into API shapes.
 * Raw full-precision numbers stay inside the backend; clients receive rounded
 * bands with a ready-made Dutch label ("3 – 5 gram CO₂").
 */

import { formatBand, everydayEquivalent, formatEquivalent } from './co2Calculator.js';

/** Rounds for presentation only. */
export const round = (value, decimals = 1) => {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
};

/**
 * CO2 band + the everyday example that belongs to the same energy.
 * Every `co2_per_year` in the API has this shape, so the UI can show the
 * example next to every CO2 amount without extra requests.
 * @returns {{ low: number, high: number, label: string, equivalent: { kind: string, low: number, high: number, label: string } }}
 */
export function presentCo2(co2_g, kwh, c) {
  return { ...formatBand(co2_g, 'co2'), equivalent: formatEquivalent(everydayEquivalent(kwh, c)) };
}

/**
 * @param {{ co2_g: {low:number,high:number}, kwh: {low:number,high:number}, storage_freed_mb?: number }} total
 * @param {Readonly<Record<string, {low:number,high:number}>>} c coefficients (for the everyday example)
 */
export function presentEstimate(total, c) {
  return {
    co2_per_year: presentCo2(total.co2_g, total.kwh, c),
    kwh_per_year: formatBand(total.kwh, 'kwh'),
    // Only present when the scenario actually concerns storage.
    ...(total.storage_freed_mb !== undefined ? { storage_freed_mb: round(total.storage_freed_mb, 1) } : {}),
  };
}
