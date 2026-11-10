/**
 * Unit tests for the Dutch display helpers of the frontend (pure functions).
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelative, lastEditedLabel, greetingFor } from '../frontend/public/js/format.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

test('formatRelative says how long ago in plain Dutch', () => {
  assert.equal(formatRelative(daysAgo(0), NOW), 'vandaag');
  assert.equal(formatRelative(daysAgo(1), NOW), 'gisteren');
  assert.equal(formatRelative(daysAgo(5), NOW), '5 dagen geleden');
  assert.equal(formatRelative(daysAgo(21), NOW), '3 weken geleden');
  assert.equal(formatRelative(daysAgo(120), NOW), '4 maanden geleden');
  assert.equal(formatRelative(daysAgo(400), NOW), '1 jaar geleden');
  assert.equal(formatRelative(daysAgo(800), NOW), '2 jaar geleden');
});

test('the label says "bewerkt", never "geopend" (only the edit date is reliable)', () => {
  assert.equal(lastEditedLabel(daysAgo(800), NOW), 'Laatst bewerkt 2 jaar geleden');
});

test('plain greeting by time of day, no emoji', () => {
  const at = (h) => new Date(2026, 10, 10, h, 0);
  assert.equal(greetingFor(at(8)), 'Goedemorgen');
  assert.equal(greetingFor(at(14)), 'Goedemiddag');
  assert.equal(greetingFor(at(20)), 'Goedenavond');
  assert.equal(greetingFor(at(2)), 'Goedenavond');
});
