/**
 * Unit tests for the CO2 calculation engine (pure functions, no database).
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAnnualFootprint, calculateMigrationSavings, calculateEquivalents,
  CO2_FACTORS, round,
} from '../backend/services/co2Calculator.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);

test('OneDrive footprint follows the documented formula', () => {
  // 1024 MB = exactly 1 GB, shared with 4 people.
  const fp = calculateAnnualFootprint({ file_size_mb: 1024, share_count: 4 }, 'OneDrive');
  const copies = 1 + CO2_FACTORS.ONEDRIVE_DUPLICATE_COPY_RATIO * 4; // 2
  close(fp.storage_copies, copies);
  close(fp.storage_kwh, copies * CO2_FACTORS.STORAGE_KWH_PER_GB_YEAR); // 0.03
  close(fp.sync_volume_gb, 4 * CO2_FACTORS.SYNC_CYCLES_PER_YEAR); // 208 GB
  close(fp.network_kwh, 208 * CO2_FACTORS.NETWORK_KWH_PER_GB); // 6.24
  close(fp.co2_grams, (fp.storage_kwh + fp.network_kwh) * CO2_FACTORS.GRID_EMISSION_FACTOR_G_PER_KWH);
});

test('SharePoint keeps one copy and cuts sync traffic by 40 %', () => {
  const file = { file_size_mb: 1024, share_count: 4 };
  const od = calculateAnnualFootprint(file, 'OneDrive');
  const sp = calculateAnnualFootprint(file, 'SharePoint');
  assert.equal(sp.storage_copies, 1);
  close(sp.network_kwh, od.network_kwh * (1 - CO2_FACTORS.SHAREPOINT_SYNC_REDUCTION));
});

test('migration savings equal the OneDrive minus SharePoint footprint', () => {
  const s = calculateMigrationSavings({ file_size_mb: 12.4, share_count: 21 });
  close(s.co2_grams_saved, s.before.co2_grams - s.after.co2_grams);
  close(s.energy_kwh_saved, s.storage_kwh_saved + s.network_kwh_saved);
  assert.ok(s.co2_grams_saved > 0);
  // Network dominates, so the reduction is slightly above the 40 % sync reduction.
  assert.ok(s.reduction_percent >= 40 && s.reduction_percent < 45, `got ${s.reduction_percent}`);
});

test('an unshared or empty file saves nothing (no division by zero)', () => {
  assert.equal(calculateMigrationSavings({ file_size_mb: 5, share_count: 0 }).co2_grams_saved, 0);
  const empty = calculateMigrationSavings({ file_size_mb: 0, share_count: 10 });
  assert.equal(empty.co2_grams_saved, 0);
  assert.equal(empty.reduction_percent, 0);
});

test('savings grow with share count and file size', () => {
  const base = calculateMigrationSavings({ file_size_mb: 10, share_count: 5 }).co2_grams_saved;
  assert.ok(calculateMigrationSavings({ file_size_mb: 10, share_count: 10 }).co2_grams_saved > base);
  assert.ok(calculateMigrationSavings({ file_size_mb: 20, share_count: 5 }).co2_grams_saved > base);
});

test('coefficients can be overridden for scenario analysis', () => {
  const file = { file_size_mb: 100, share_count: 5 };
  const conservative = { ...CO2_FACTORS, ONEDRIVE_DUPLICATE_COPY_RATIO: 0 };
  const s = calculateMigrationSavings(file, conservative);
  assert.equal(s.storage_kwh_saved, 0); // no duplicates -> no storage saving
  assert.ok(s.network_kwh_saved > 0);
});

test('invalid input is rejected instead of producing NaN', () => {
  assert.throws(() => calculateAnnualFootprint({ file_size_mb: -1, share_count: 1 }, 'OneDrive'), RangeError);
  assert.throws(() => calculateAnnualFootprint({ file_size_mb: 1, share_count: 1.5 }, 'OneDrive'), RangeError);
  assert.throws(() => calculateAnnualFootprint({ file_size_mb: 1, share_count: 1 }, 'Dropbox'), RangeError);
  assert.throws(() => calculateAnnualFootprint(null, 'OneDrive'), TypeError);
});

test('equivalents convert kWh and grams into Amsterdam metaphors', () => {
  const eq = calculateEquivalents({ energy_kwh: 0.4, co2_grams: 22000 });
  close(eq.streetlight_hours, 10); // 400 Wh / 40 W
  close(eq.trees_for_a_year, 1);
  close(eq.tree_days, 365);
  close(eq.car_km_avoided, 22000 / 150);
});

test('round() rounds half up at the requested precision', () => {
  assert.equal(round(1.005, 2), 1.01);
  assert.equal(round(14.9349, 2), 14.93);
});
