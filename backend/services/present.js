/**
 * @file present.js
 * @description Presentation helpers: turn raw engine bands into API shapes.
 * Raw full-precision numbers stay inside the backend; clients receive rounded
 * bands with a ready-made Dutch label ("3 – 5 gram CO₂").
 */

import { formatBand } from './co2Calculator.js';

/** Rounds for presentation only. */
export const round = (value, decimals = 1) => {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
};

/**
 * @param {{ co2_g: {low:number,high:number}, kwh: {low:number,high:number}, storage_freed_mb?: number }} total
 */
export function presentEstimate(total) {
  return {
    co2_per_year: formatBand(total.co2_g, 'co2'),
    kwh_per_year: formatBand(total.kwh, 'kwh'),
    // Only present when the scenario actually concerns storage.
    ...(total.storage_freed_mb !== undefined ? { storage_freed_mb: round(total.storage_freed_mb, 1) } : {}),
  };
}

