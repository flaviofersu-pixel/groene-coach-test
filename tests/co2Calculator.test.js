/**
 * Unit tests for the compliant CO2 engine (pure functions, no database).
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coefficientsFromRows, storageGramsPerGbYear, networkGramsPerGb, estimateMigration,
  estimateDuplicateRemoval, estimateAttachmentCloning, cumulativeCloningWaste, equivalents, formatBand, band,
  everydayEquivalent, formatEquivalent,
} from '../backend/services/co2Calculator.js';
import { CO2_METRICS } from '../backend/db/seedData.js';

// Same rows the database is seeded with.
const rows = CO2_METRICS.map(([key, label, value_low, value_high]) => ({ key, label, value_low, value_high }));
const c = coefficientsFromRows(rows);
const stored = Object.fromEntries(rows.map((r) => [r.key, r]));
const NOW = new Date('2026-11-03T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);

test('storage coefficient derives from 0.65 W/TB, PUE 1.185 and 0.268 kg/kWh (≈ 3.6 g/GB/yr upper bound)', () => {
  const s = storageGramsPerGbYear(c);
  // 0.65 × 8760 / 1000 / 1000 × 1.185 × 268 = 1.8083 g per replica
  close(s.low, 0.65 * 8760 / 1e6 * 1.185 * 268);
  close(s.high, 2 * s.low);
  // The derived row stored in co2_metrics must match the engine (no silent drift).
  close(s.low, stored.storage_g_per_gb_year.value_low, 0.001);
  close(s.high, stored.storage_g_per_gb_year.value_high, 0.001);
  assert.ok(s.high > 3.5 && s.high < 3.7);
});

test('network sync coefficient matches its stored derived row', () => {
  const n = networkGramsPerGb(c);
  close(n.low, stored.network_sync_g_per_gb.value_low, 0.001);
  close(n.high, stored.network_sync_g_per_gb.value_high, 0.001);
});

test('a single move frees 0 bytes of storage; savings come from sync and backup only', () => {
  const est = estimateMigration({ size_mb: 5.8, times_shared: 14, last_modified: daysAgo(1) }, c, NOW);
  assert.equal(est.storage.freed_mb, 0);
  assert.deepEqual(est.storage.co2_g, band(0));
  assert.equal(est.total.storage_freed_mb, 0);
  close(est.total.co2_g.low, est.sync.co2_g.low + est.backup.co2_g.low);
  close(est.total.co2_g.high, est.sync.co2_g.high + est.backup.co2_g.high);
});

test('sync saving follows the documented formula', () => {
  const est = estimateMigration({ size_mb: 1024, times_shared: 10, last_modified: daysAgo(1) }, c, NOW);
  // 1 GB × 10 people × 12 edits × 30 % = 36 GB (low) ; × 52 × 50 % = 260 GB (high)
  close(est.sync.saved_gb.low, 36);
  close(est.sync.saved_gb.high, 260);
  close(est.sync.kwh.low, 36 * 0.006);
  close(est.sync.kwh.high, 260 * 0.015);
  close(est.sync.co2_g.high, 260 * 0.015 * 268);
});

test('the backup lower bound is 0 (honest: backup tooling may already deduplicate)', () => {
  const est = estimateMigration({ size_mb: 50, times_shared: 8, last_modified: daysAgo(5) }, c, NOW);
  assert.equal(est.backup.co2_g.low, 0);
  assert.ok(est.backup.co2_g.high > 0);
});

test('dormant files save much less than active ones', () => {
  const file = { size_mb: 20, times_shared: 10 };
  const active = estimateMigration({ ...file, last_modified: daysAgo(10) }, c, NOW);
  const dormant = estimateMigration({ ...file, last_modified: daysAgo(400) }, c, NOW);
  assert.equal(active.activity, 'active');
  assert.equal(dormant.activity, 'dormant');
  assert.equal(dormant.total.co2_g.low, 0);
  assert.ok(dormant.total.co2_g.high < active.total.co2_g.high);
});

test('breaking a duplicate chain frees storage: size × copies × storage coefficient', () => {
  const r = estimateDuplicateRemoval(512, 2, c).total; // 2 copies of 0.5 GB = 1 GB
  assert.equal(r.storage_freed_mb, 1024);
  const s = storageGramsPerGbYear(c);
  close(r.co2_g.low, s.low);
  close(r.co2_g.high, s.high);
});

test('Rick van Kersbergen rule: 1 attachment to 20 people = 20× storage', () => {
  const est = estimateAttachmentCloning({ sizeMb: 10, recipients: 20 }, c);
  assert.equal(est.copies, 20);
  assert.equal(est.amplification, 20);
  assert.equal(est.duplicate_mb, 200);
  close(est.annual.co2_g.high, (200 / 1024) * storageGramsPerGbYear(c).high);
  assert.ok(est.transfer.co2_g.high > 0);
});

test('cumulative cloning waste sums all attachments', () => {
  const w = cumulativeCloningWaste([{ size_mb: 10, recipient_count: 20 }, { size_mb: 5, recipient_count: 4 }], c);
  assert.equal(w.attachments, 2);
  assert.equal(w.duplicate_mb, 220);
  assert.equal(w.recipients_total, 24);
  assert.equal(w.average_amplification, 12);
});

test('equivalents: 1 kWh = 25 canal-lamp hours; cooling = (PUE-1)/PUE of data-centre energy', () => {
  const eq = equivalents({ kwh: band(1, 2), dc_kwh: band(1.185) }, c);
  close(eq.lamp_hours.low, 25);
  close(eq.lamp_hours.high, 50);
  close(eq.cooling_kwh.low, 0.185);
});

test('formatBand returns honest, outward-rounded ranges instead of exact numbers', () => {
  assert.equal(formatBand(band(3.2, 4.6)).label, '3 – 5 gram CO₂');
  assert.equal(formatBand(band(0.46, 8.96)).label, '0,4 – 9 gram CO₂');
  assert.equal(formatBand(band(14.2, 37.2)).label, '14 – 38 gram CO₂');
  assert.equal(formatBand(band(0, 0)).label, '0 gram CO₂');
  assert.equal(formatBand(band(1200, 2600)).label, '1 – 3 kg CO₂');
  assert.equal(formatBand(band(4, 4)).label, 'ca. 4 gram CO₂');
  assert.equal(formatBand(band(0.3, 0.3)).low, 0.3); // float-safe rounding
  assert.equal(formatBand(band(0.09, 2.1), 'kwh').label, '0,09 – 3 kWh');
});

test('everyday example: phone charges for small savings, kettle litres once at least one is certain', () => {
  // 0.1 kWh: not certainly one kettle litre (0.104 – 0.124 kWh), so phone charges.
  const small = everydayEquivalent(band(0.05, 0.1), c);
  assert.equal(small.kind, 'phone');
  close(small.count.low, 0.05 / c.phone_charge_kwh.high); // least energy ÷ most per charge
  close(small.count.high, 0.1 / c.phone_charge_kwh.low);  // most energy ÷ least per charge

  const big = everydayEquivalent(band(0.5, 1), c);
  assert.equal(big.kind, 'kettle');
  assert.ok(big.count.low >= 1);
});

test('everyday example labels stay honest ranges in plain Dutch', () => {
  assert.equal(formatEquivalent({ kind: 'phone', count: band(1.2, 3.4) }).label, '1 – 4 keer je telefoon opladen');
  assert.equal(formatEquivalent({ kind: 'phone', count: band(0.05, 0.6) }).label, 'minder dan 1 keer je telefoon opladen');
  assert.equal(formatEquivalent({ kind: 'phone', count: band(0, 2.2) }).label, 'tot 3 keer je telefoon opladen');
  assert.equal(formatEquivalent({ kind: 'kettle', count: band(2, 5) }).label, '2 – 5 keer 1 liter water koken');
  assert.equal(formatEquivalent({ kind: 'phone', count: band(0, 0) }).label, 'geen meetbare besparing');
});

test('missing coefficients and invalid input fail loudly', () => {
  assert.throws(() => coefficientsFromRows(rows.slice(1)), /missing: grid_emission_factor/);
  assert.throws(() => estimateMigration({ size_mb: -1, times_shared: 1, last_modified: daysAgo(1) }, c, NOW), RangeError);
  assert.throws(() => estimateAttachmentCloning({ sizeMb: 1, recipients: 0 }, c), RangeError);
});
