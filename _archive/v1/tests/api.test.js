/**
 * Integration tests: the real Express app + seeded in-memory SQLite database,
 * exercised over HTTP. The data file in /data is never touched.
 * Run: npm test
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../backend/db/database.js';
import { seedDatabase } from '../backend/db/seed.js';
import { createApp } from '../backend/app.js';
import { FILES } from '../backend/db/seedData.js';

const NOW = new Date('2026-11-03T12:00:00Z');
let server;
let base;
let db;

before(async () => {
  db = openDatabase(':memory:');
  seedDatabase(db, { now: NOW });
  const app = createApp({ db, logRequests: false });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};
const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('seed contains 50+ files', () => {
  assert.ok(FILES.length >= 50);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM files').get().n, FILES.length);
});

test('GET /api/health', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('GET /api/files/scan-onedrive only returns OneDrive files with share_count > 2', async () => {
  const { status, body } = await get('/api/files/scan-onedrive');
  assert.equal(status, 200);
  assert.ok(body.count > 0);
  for (const f of body.files) {
    assert.equal(f.current_location, 'OneDrive');
    assert.ok(f.share_count > 2, `${f.filename} has share_count ${f.share_count}`);
    assert.ok(f.projected_savings.co2_grams_per_year >= 0);
  }
  // Ranked by impact (largest saving first).
  const savings = body.files.map((f) => f.projected_savings.co2_grams_per_year);
  assert.deepEqual(savings, [...savings].sort((a, b) => b - a));
});

test('scan can be limited to one user', async () => {
  const { body } = await get('/api/files/scan-onedrive?user=u01');
  assert.ok(body.count > 0);
  assert.ok(body.files.every((f) => f.owner_user_id === 'u01'));
});

test('migrate moves a file to SharePoint and records CO2 savings', async () => {
  const before = await get('/api/stats/co2-saved?user=u01');
  const { body: scan } = await get('/api/files/scan-onedrive?user=u01');
  const target = scan.files[0];

  const { status, body } = await post('/api/files/migrate-to-sharepoint', { fileId: target.id, userId: 'u01' });
  assert.equal(status, 200);
  assert.equal(body.file.current_location, 'SharePoint');
  assert.equal(body.savings.co2_grams_per_year, target.projected_savings.co2_grams_per_year);

  // The file is no longer a candidate...
  const { body: rescan } = await get('/api/files/scan-onedrive?user=u01');
  assert.ok(!rescan.files.some((f) => f.id === target.id));

  // ...and the statistics went up by exactly that saving.
  const afterStats = await get('/api/stats/co2-saved?user=u01');
  assert.equal(afterStats.body.user.files_migrated, before.body.user.files_migrated + 1);
  assert.ok(
    Math.abs(afterStats.body.user.co2_grams_saved_per_year -
      (before.body.user.co2_grams_saved_per_year + target.projected_savings.co2_grams_per_year)) < 0.1
  );
  assert.equal(afterStats.body.coaching.accepted, before.body.coaching.accepted + 1);
});

test('migrating twice returns 409', async () => {
  const { body: scan } = await get('/api/files/scan-onedrive?user=u02');
  const id = scan.files[0].id;
  assert.equal((await post('/api/files/migrate-to-sharepoint', { fileId: id })).status, 200);
  const second = await post('/api/files/migrate-to-sharepoint', { fileId: id });
  assert.equal(second.status, 409);
  assert.match(second.body.error.message, /al op SharePoint/);
});

test('only the owner can migrate a file (403)', async () => {
  const { body: scan } = await get('/api/files/scan-onedrive?user=u03');
  const res = await post('/api/files/migrate-to-sharepoint', { fileId: scan.files[0].id, userId: 'u01' });
  assert.equal(res.status, 403);
});

test('"Nu niet" is logged, keeps the file in OneDrive and snoozes it', async () => {
  const { body: scan } = await get('/api/files/scan-onedrive?user=u04');
  const target = scan.files[0];

  const res = await post('/api/files/decline', { fileId: target.id, userId: 'u04' });
  assert.equal(res.status, 201);
  assert.equal(res.body.current_location, 'OneDrive');

  const { body: rescan } = await get('/api/files/scan-onedrive?user=u04');
  assert.ok(!rescan.files.some((f) => f.id === target.id), 'snoozed file should be hidden');
  assert.equal(rescan.snoozed_count, 1);

  const { body: withSnoozed } = await get('/api/files/scan-onedrive?user=u04&includeSnoozed=true');
  assert.ok(withSnoozed.files.some((f) => f.id === target.id));

  const row = db.prepare("SELECT current_location FROM files WHERE id = ?").get(target.id);
  assert.equal(row.current_location, 'OneDrive');
});

test('GET /api/stats/co2-saved returns organisation, department and user totals', async () => {
  const { status, body } = await get('/api/stats/co2-saved?user=u01');
  assert.equal(status, 200);
  assert.ok(body.total.co2_grams_saved_per_year > 0);
  assert.ok(body.total.mb_migrated > 0);
  assert.equal(body.department.name, 'Wonen');
  // Wonen has two users with migrations, so the department beats the individual.
  assert.ok(body.department.co2_grams_saved_per_year > body.user.co2_grams_saved_per_year);
  assert.ok(body.departments.length >= 8);
  assert.ok('streetlight_hours' in body.user.equivalents);
  assert.equal(body.methodology.co2_factors.SHAREPOINT_SYNC_REDUCTION, 0.4);
});

test('organisation-wide stats work without a user', async () => {
  const { status, body } = await get('/api/stats/co2-saved');
  assert.equal(status, 200);
  assert.equal(body.user, null);
  assert.ok(body.total.files_migrated > 0);
});

test('input validation and error handling', async () => {
  assert.equal((await post('/api/files/migrate-to-sharepoint', {})).status, 400);
  assert.equal((await post('/api/files/migrate-to-sharepoint', { fileId: 'abc' })).status, 400);
  assert.equal((await post('/api/files/migrate-to-sharepoint', { fileId: 99999 })).status, 404);
  assert.equal((await post('/api/files/decline', '{not json')).status, 400);
  assert.equal((await get('/api/files/scan-onedrive?user=nobody')).status, 404);
  assert.equal((await get('/api/files/scan-onedrive?user=../etc')).status, 400);
  assert.equal((await get('/api/files?location=Dropbox')).status, 400);
  const notFound = await get('/api/does-not-exist');
  assert.equal(notFound.status, 404);
  assert.ok(notFound.body.error.message);
});
