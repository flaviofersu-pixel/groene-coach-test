/**
 * Integration tests: the real Express app + seeded in-memory SQLite tenant,
 * exercised over HTTP with simulated SSO tokens. /data is never touched.
 * Run: npm test
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../backend/db/database.js';
import { seedDatabase } from '../backend/db/seed.js';
import { createApp } from '../backend/app.js';
import { config, GRAPH_SCOPES } from '../backend/config.js';

const NOW = new Date('2026-11-03T12:00:00Z');

/** Starts an app on a random port; returns helpers bound to it. */
async function startApp({ auth = config.auth } = {}) {
  const db = openDatabase(':memory:');
  seedDatabase(db, { now: NOW });
  const clock = { now: NOW };
  const app = createApp({ db, logRequests: false, now: () => clock.now, auth });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const signIn = async (userId) => (await call('POST', '/api/auth/simulated-sso', { body: { userId } })).body.access_token;
  return { db, clock, server, call, signIn };
}

describe('OpruimCoach API', () => {
  let t;
  let sanne; // u01 · Wonen
  let lotte; // u07 · Financiën
  before(async () => {
    t = await startApp();
    sanne = await t.signIn('u01');
    lotte = await t.signIn('u07');
  });
  after(() => { t.server.close(); t.db.close(); });

  test('seed: 50+ files and duplicate chains', () => {
    assert.ok(t.db.prepare('SELECT COUNT(*) AS n FROM files').get().n >= 50);
    const chains = t.db.prepare('SELECT COUNT(*) AS n FROM (SELECT content_hash FROM files GROUP BY content_hash HAVING COUNT(*) > 2)').get().n;
    assert.ok(chains >= 4);
  });

  test('authentication: missing, tampered and expired tokens are rejected (401)', async () => {
    assert.equal((await t.call('GET', '/api/files/scan-onedrive')).status, 401);
    const [h, p, s] = sanne.split('.');
    const forgedClaims = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), sub: 'u07' })).toString('base64url');
    assert.equal((await t.call('GET', '/api/files/scan-onedrive', { token: `${h}.${forgedClaims}.${s}` })).status, 401);

    const shortLived = await t.signIn('u01');
    t.clock.now = new Date(NOW.getTime() + 16 * 60 * 1000); // TTL is 15 minutes
    assert.equal((await t.call('GET', '/api/files/scan-onedrive', { token: shortLived })).status, 401);
    t.clock.now = NOW;
  });

  test('Action Hub: only own OneDrive files with times_shared > 2, with CO2 bands', async () => {
    const { status, body } = await t.call('GET', '/api/files/scan-onedrive', { token: sanne });
    assert.equal(status, 200);
    assert.ok(body.count > 0);
    for (const f of body.files) {
      assert.equal(f.current_location, 'OneDrive');
      assert.ok(f.times_shared > 2);
      assert.match(f.estimate.co2_per_year.label, /gram CO₂|kg CO₂/);
      assert.match(f.estimate.co2_per_year.equivalent.label, /telefoon|water|besparing/); // everyday example
      assert.equal(f.estimate.storage_freed_mb, 0); // single move: no storage saving
      assert.equal(f.estimate.breakdown.storage.label, '0 gram CO₂');
      assert.equal(f.suggested_site.display_name, 'Wonen'); // own team site
      assert.ok(f.reason.length > 0 && !/weg mag/i.test(f.reason));
    }
    const own = t.db.prepare("SELECT id FROM files WHERE owner_id = 'u01'").all().map((r) => r.id);
    assert.ok(body.files.every((f) => own.includes(f.id)));
  });

  test('migrate: OneDrive -> department site; second attempt 409; foreign file 403', async () => {
    const { body: scan } = await t.call('GET', '/api/files/scan-onedrive', { token: sanne });
    const target = scan.files.find((f) => f.filename === 'Beleidsplan_Wonen_v2.docx');

    const res = await t.call('POST', '/api/files/migrate-to-sharepoint', { token: sanne, body: { fileId: target.id } });
    assert.equal(res.status, 200);
    assert.equal(res.body.file.current_location, 'SharePoint');
    assert.equal(res.body.site.display_name, 'Wonen');
    assert.match(res.body.storage_note, /geen opslag/);

    assert.equal((await t.call('POST', '/api/files/migrate-to-sharepoint', { token: sanne, body: { fileId: target.id } })).status, 409);

    const lottesFile = t.db.prepare("SELECT id FROM files WHERE owner_id = 'u07' AND current_location = 'OneDrive' LIMIT 1").get().id;
    assert.equal((await t.call('POST', '/api/files/migrate-to-sharepoint', { token: sanne, body: { fileId: lottesFile } })).status, 403);
  });

  test('Verkenner: the user picks the folder; a folder of another site is refused', async () => {
    const { body: tree } = await t.call('GET', '/api/user/sharepoint-tree', { token: sanne });
    const wonen = tree.sites.find((site) => site.display_name === 'Wonen');
    assert.ok(wonen.folders.some((f) => f.name === 'Beleid'));
    assert.ok(!tree.sites.some((site) => site.display_name === 'Financiën')); // not a member
    const beleid = wonen.folders.find((f) => f.name === 'Beleid');

    const fileId = t.db.prepare("SELECT id FROM files WHERE owner_id = 'u01' AND filename = 'Huurtoeslag_analyse_Q3.xlsx'").get().id;
    const otherSiteFolder = t.db.prepare("SELECT id FROM sharepoint_folders WHERE site_id = 's03' LIMIT 1").get().id;
    const wrong = await t.call('POST', '/api/files/migrate-to-sharepoint', { token: sanne, body: { fileId, siteId: 's01', folderId: otherSiteFolder } });
    assert.equal(wrong.status, 404);

    const res = await t.call('POST', '/api/files/migrate-to-sharepoint', { token: sanne, body: { fileId, siteId: 's01', folderId: beleid.id } });
    assert.equal(res.status, 200);
    assert.equal(res.body.folder.name, 'Beleid');
    const { body: after } = await t.call('GET', '/api/user/sharepoint-tree', { token: sanne });
    const beleidAfter = after.sites.find((site) => site.id === 's01').folders.find((f) => f.id === beleid.id);
    assert.ok(beleidAfter.files.some((f) => f.name === 'Huurtoeslag_analyse_Q3.xlsx'));
  });

  test('"Nu niet" hides the suggestion and leaves the file untouched', async () => {
    const { body: scan } = await t.call('GET', '/api/files/scan-onedrive', { token: sanne });
    const target = scan.files[0];
    const res = await t.call('POST', '/api/files/snooze', { token: sanne, body: { fileId: target.id } });
    assert.equal(res.status, 201);
    assert.equal(res.body.current_location, 'OneDrive');
    const { body: rescan } = await t.call('GET', '/api/files/scan-onedrive', { token: sanne });
    assert.ok(!rescan.files.some((f) => f.id === target.id));
    assert.equal(rescan.snoozed_count, 1);
  });

  test('duplicate clean-up needs explicit confirmation, uses the recycle bin and can be undone', async () => {
    const { body } = await t.call('GET', '/api/files/duplicate-chains', { token: sanne });
    const chain = body.chains.find((ch) => ch.can_consolidate);
    assert.ok(chain, 'Sanne should have a chain with an own redundant copy');
    const filesBefore = t.db.prepare('SELECT COUNT(*) AS n FROM files').get().n;

    const unconfirmed = await t.call('POST', '/api/files/consolidate-duplicates', { token: sanne, body: { contentHash: chain.content_hash } });
    assert.equal(unconfirmed.status, 400);

    const res = await t.call('POST', '/api/files/consolidate-duplicates',
      { token: sanne, body: { contentHash: chain.content_hash, confirmed: true } });
    assert.equal(res.status, 200);
    assert.equal(res.body.recycled.length, chain.removable_count);
    assert.ok(res.body.estimate.storage_freed_mb > 0);
    assert.ok(!('colleagues_with_copy' in res.body)); // colleagues are never counted

    // Archiefwet: nothing was hard-deleted.
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM files').get().n, filesBefore);
    const recycledId = res.body.recycled[0].id;
    assert.equal(t.db.prepare('SELECT status FROM files WHERE id = ?').get(recycledId).status, 'recycled');

    const undo = await t.call('POST', `/api/files/${recycledId}/restore`, { token: sanne });
    assert.equal(undo.status, 200);
    assert.equal(undo.body.status, 'active');
  });

  test('Verkenner: all own OneDrive files with an honest "last edited" date and no people counts', async () => {
    const { status, body } = await t.call('GET', '/api/files/onedrive', { token: sanne });
    assert.equal(status, 200);
    const odCount = t.db.prepare("SELECT COUNT(*) AS n FROM files WHERE owner_id = 'u01' AND current_location = 'OneDrive' AND status = 'active'").get().n;
    assert.equal(body.files.length, odCount);
    for (const f of body.files) {
      assert.ok(!Number.isNaN(Date.parse(f.last_modified)));
      assert.equal(typeof f.is_shared, 'boolean');
      assert.ok(!('times_shared' in f)); // yes/no only, never how many people
    }
    assert.ok(body.files.some((f) => f.is_old)); // Leegstandsmonitor: 400 days ago
  });

  test('Actie-hub: action list with counts and honest savings', async () => {
    const { status, body } = await t.call('GET', '/api/files/actions', { token: lotte });
    assert.equal(status, 200);
    const byId = Object.fromEntries(body.actions.map((a) => [a.id, a]));
    assert.deepEqual(Object.keys(byId).sort(), ['duplicates', 'move', 'old', 'shortcut']);
    assert.ok(byId.move.count > 0);
    assert.match(byId.move.estimate.co2_per_year.label, /CO₂/);
    assert.ok(byId.duplicates.count >= 1); // two own copies of Begroting_2027_concept.xlsx
    assert.equal(byId.old.estimate, null); // depends on the retention rules: no figure
  });

  test('duplicates: only copies in your own OneDrive or on your own team sites', async () => {
    const { body } = await t.call('GET', '/api/files/duplicate-chains', { token: lotte });
    for (const ch of body.chains) {
      assert.ok(!('colleagues_with_copy' in ch) && !('total_copies' in ch));
      assert.equal(ch.match, 'hash');
    }
    // Lotte has one copy of the parking subsidy file; the original is on a site she is NOT a member of.
    assert.ok(!body.chains.some((ch) => ch.filename.startsWith('Subsidie_Aanvraag_Parkeren')));
    assert.ok(body.chains.some((ch) => ch.filename === 'Begroting_2027_concept.xlsx' && ch.can_consolidate));
  });

  test('database trigger blocks hard deletes of drive items', () => {
    assert.throws(() => t.db.prepare('DELETE FROM files WHERE id = 1').run(), /Archiefwet/);
  });

  test('SharePoint Mapper: inserts a shortcut once (idempotent) and shows it in the Explorer view', async () => {
    const first = await t.call('POST', '/api/user/map-sharepoint-shortcut', { token: sanne, body: {} });
    assert.equal(first.status, 201);
    assert.equal(first.body.shortcut.name, 'Wonen - Documenten');
    const again = await t.call('POST', '/api/user/map-sharepoint-shortcut', { token: sanne, body: {} });
    assert.equal(again.status, 200);
    assert.equal(again.body.created, false);

    const view = await t.call('GET', '/api/user/explorer-view', { token: sanne });
    const shortcut = view.body.after.items.find((i) => i.type === 'shortcut');
    assert.equal(shortcut.name, 'Wonen - Documenten');
    assert.ok(shortcut.children.some((folder) => folder.name === 'Verhuisd vanuit OneDrive'
      && folder.children.some((f) => f.tag === 'moved')));
    assert.ok(!view.body.before.items.some((i) => i.type === 'shortcut'));
    assert.ok(view.body.after.personal_file_count < view.body.before.personal_file_count);
  });

  test('SharePoint Mapper: only sites the user is a member of (403)', async () => {
    const res = await t.call('POST', '/api/user/map-sharepoint-shortcut', { token: sanne, body: { siteId: 's03' } });
    assert.equal(res.status, 403);
  });

  test('Outlook Smart Alert: 20 recipients = 20× amplification; user may send anyway', async () => {
    const fileId = t.db.prepare("SELECT id FROM files WHERE owner_id = 'u07' AND filename = 'Begroting_2027_concept.xlsx'").get().id;
    const evalRes = await t.call('POST', '/api/outlook/evaluate-send', { token: lotte, body: { fileIds: [fileId], recipientCount: 20 } });
    assert.equal(evalRes.status, 200);
    assert.equal(evalRes.body.alert, true);
    assert.equal(evalRes.body.send_mode, 'promptUser');
    assert.equal(evalRes.body.amplification, 20);
    assert.ok(evalRes.body.options.some((o) => o.id === 'send_anyway'));

    const single = await t.call('POST', '/api/outlook/evaluate-send', { token: lotte, body: { fileIds: [fileId], recipientCount: 1 } });
    assert.equal(single.body.alert, false);

    const before = (await t.call('GET', '/api/stats/impact', { token: lotte })).body.organisation.mail_links;
    const resolved = await t.call('POST', '/api/outlook/resolve', { token: lotte, body: { decision: 'share_link', fileIds: [fileId], recipientCount: 20 } });
    assert.equal(resolved.body.sharing_links.length, 1);
    const afterLinks = (await t.call('GET', '/api/stats/impact', { token: lotte })).body.organisation.mail_links;
    assert.equal(afterLinks, before + 1);
  });

  test('impact: aggregated, k-anonymous, personal figures only for yourself', async () => {
    const { body } = await t.call('GET', '/api/stats/impact', { token: sanne });
    assert.ok(body.personal.actions >= 1);
    assert.equal(body.department.name, 'Wonen');
    assert.ok(!body.department.suppressed);
    assert.match(body.organisation.co2_per_year.label, / – /);
    assert.ok(body.organisation.email_cloning.average_amplification > 1);
    assert.ok(body.departments.every((d) => !('user_id' in d)));
    // The telemetry table has no column that could hold a person.
    const cols = t.db.prepare('PRAGMA table_info(telemetry_daily)').all().map((c) => c.name);
    assert.ok(!cols.some((c) => /user|owner|email|name/.test(c)));
  });

  test('public coefficient table includes the 3.6 g/GB/yr storage bound', async () => {
    const { body } = await t.call('GET', '/api/co2-metrics');
    const storage = body.metrics.find((m) => m.key === 'storage_g_per_gb_year');
    assert.ok(Math.abs(storage.value_high - 3.6) < 0.05);
    assert.equal(body.metrics.find((m) => m.key === 'grid_emission_factor').value_low, 268);
  });

  test('input validation', async () => {
    assert.equal((await t.call('POST', '/api/files/migrate-to-sharepoint', { token: sanne, body: {} })).status, 400);
    assert.equal((await t.call('POST', '/api/files/migrate-to-sharepoint', { token: sanne, body: { fileId: 99999 } })).status, 404);
    assert.equal((await t.call('POST', '/api/files/snooze', { token: sanne, body: '{bad json' })).status, 400);
    assert.equal((await t.call('POST', '/api/outlook/evaluate-send', { token: sanne, body: { fileIds: [], recipientCount: 5 } })).status, 400);
    assert.equal((await t.call('POST', '/api/outlook/resolve', { token: sanne, body: { decision: 'delete', fileIds: [1], recipientCount: 5 } })).status, 400);
    assert.equal((await t.call('POST', '/api/files/consolidate-duplicates', { token: sanne, body: { contentHash: "x' OR 1=1", confirmed: true } })).status, 400);
    assert.equal((await t.call('POST', '/api/auth/simulated-sso', { body: { userId: '../etc' } })).status, 400);
    assert.equal((await t.call('GET', '/api/nope')).status, 404);
  });
});

describe('without admin consent for Files.ReadWrite.All', () => {
  let t;
  before(async () => {
    t = await startApp({ auth: { ...config.auth, adminConsentGranted: false, grantedScopes: [GRAPH_SCOPES.USER_READ] } });
  });
  after(() => { t.server.close(); t.db.close(); });

  test('Graph calls are refused with 403 and an explanation', async () => {
    const token = await t.signIn('u01');
    const scan = await t.call('GET', '/api/files/scan-onedrive', { token });
    assert.equal(scan.status, 403);
    assert.match(scan.body.error.message, /admin consent/);
    const move = await t.call('POST', '/api/files/migrate-to-sharepoint', { token, body: { fileId: 1 } });
    assert.equal(move.status, 403);
    const me = await t.call('GET', '/api/user/me', { token });
    assert.equal(me.body.admin_consent_granted, false);
  });
});
