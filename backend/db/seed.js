/**
 * @file seed.js
 * @description Builds the Microsoft 365 tenant simulation from seedData.js.
 *
 * Usage:  npm run seed   -> drops and recreates data/m365-tenant-sim.db
 *
 * Also exports `seedDatabase()` so the server (first start) and the tests can
 * seed a connection. Historical actions go through the same calculator and
 * telemetry code as live actions, so seeded and live figures are consistent.
 */

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { openDatabase, resetSchema, inTransaction } from './database.js';
import {
  CO2_METRICS, SITES, USERS, SITE_OWNERS, PROGRAMME_MEMBERS, EXISTING_SHORTCUTS,
  ONEDRIVE_FOLDERS, MOVED_FOLDER, FILES, MAIL_ATTACHMENTS, PAST_MAIL_DECISIONS,
} from './seedData.js';
import { coefficientsFromRows, estimateMigration, estimateAttachmentCloning } from '../services/co2Calculator.js';
import { createTelemetry } from '../services/telemetry.js';

const DAY_MS = 86_400_000;
const daysAgo = (now, d) => new Date(now.getTime() - d * DAY_MS).toISOString();
const monthKey = (now, monthsAgo) => {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * Simulated Graph `quickXorHash`: deterministic, base64, 27 chars + '='.
 * Copies in one chain share the key, so they share the hash.
 */
const simulatedHash = (key) => `${crypto.createHash('sha256').update(key).digest('base64').slice(0, 27)}=`;

/** Turns 'Sanne de Vries' into 's.devries@amsterdam.example'. */
const emailFor = (name) => {
  const [first, ...rest] = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(' ');
  return `${first[0]}.${rest.join('').replace(/[^a-z]/g, '')}@amsterdam.example`;
};

/**
 * Drops all tables and inserts the demo tenant in one transaction.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: Date }} [options]
 */
export function seedDatabase(db, { now = new Date() } = {}) {
  resetSchema(db);

  return inTransaction(db, () => {
    const q = {
      metric: db.prepare(`INSERT INTO co2_metrics (key, label, value_low, value_high, unit, category, derivation, source)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      site: db.prepare('INSERT INTO sharepoint_sites (id, display_name, department, web_url) VALUES (?, ?, ?, ?)'),
      spFolder: db.prepare('INSERT INTO sharepoint_folders (site_id, name) VALUES (?, ?)'),
      user: db.prepare('INSERT INTO users (id, display_name, email, department) VALUES (?, ?, ?, ?)'),
      member: db.prepare('INSERT INTO site_memberships (user_id, site_id, role) VALUES (?, ?, ?)'),
      odItem: db.prepare(`INSERT INTO onedrive_items (owner_id, parent_id, name, item_type, target_site_id, created_at)
                          VALUES (?, NULL, ?, ?, ?, ?)`),
      file: db.prepare(`INSERT INTO files (filename, current_location, size_mb, owner_id, department, times_shared,
                          last_modified, content_hash, onedrive_folder_id, sharepoint_folder_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      log: db.prepare(`INSERT INTO migration_log (user_id, file_id, action, from_location, from_folder, to_location,
                          to_site_id, size_mb, storage_freed_mb, co2_low_g, co2_high_g, kwh_low, kwh_high, at)
                        VALUES (?, ?, 'migrate', 'OneDrive', 'Documenten', 'SharePoint', ?, ?, 0, ?, ?, ?, ?, ?)`),
      mail: db.prepare('INSERT INTO mail_attachment_stats (department, month, size_mb, recipient_count) VALUES (?, ?, ?, ?)'),
    };

    // 1. Coefficients
    for (const row of CO2_METRICS) q.metric.run(...row);
    const c = coefficientsFromRows(db.prepare('SELECT * FROM co2_metrics').all());
    const telemetry = createTelemetry(db);

    // 2. Sites + library folders
    const siteFolderId = new Map(); // `${siteId}/${name}` -> id
    const siteByDepartment = new Map();
    for (const [id, name, department, folders] of SITES) {
      const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-');
      q.site.run(id, name, department, `https://amsterdam.sharepoint.example/sites/${slug}`);
      for (const f of [...folders, MOVED_FOLDER]) {
        siteFolderId.set(`${id}/${f}`, Number(q.spFolder.run(id, f).lastInsertRowid));
      }
      if (department) siteByDepartment.set(department, id);
    }

    // 3. Users, memberships, OneDrive root folders, existing shortcuts
    const departmentOf = new Map();
    const odFolderId = new Map(); // `${userId}/${folder}` -> id
    for (const [id, name, department] of USERS) {
      q.user.run(id, name, emailFor(name), department);
      departmentOf.set(id, department);
      const siteId = siteByDepartment.get(department);
      q.member.run(id, siteId, SITE_OWNERS[siteId] === id ? 'owner' : 'member');
      for (const folder of ONEDRIVE_FOLDERS) {
        odFolderId.set(`${id}/${folder}`, Number(q.odItem.run(id, folder, 'folder', null, daysAgo(now, 400)).lastInsertRowid));
      }
    }
    for (const [siteId, members] of Object.entries(PROGRAMME_MEMBERS)) {
      for (const userId of members) q.member.run(userId, siteId, SITE_OWNERS[siteId] === userId ? 'owner' : 'member');
    }
    const siteName = new Map(SITES.map(([id, name]) => [id, name]));
    for (const [userId, siteId, ago] of EXISTING_SHORTCUTS) {
      q.odItem.run(userId, `${siteName.get(siteId)} - Documenten`, 'shortcut', siteId, daysAgo(now, ago));
      telemetry.record({ department: departmentOf.get(userId), event: 'shortcut_mapped', at: daysAgo(now, ago) });
    }

    // 4. Files (+ historical migrations through the same calculator as live moves)
    let migrations = 0;
    for (const [filename, ownerId, location, sizeMb, shares, modifiedAgo, folder, opts = {}] of FILES) {
      const department = departmentOf.get(ownerId);
      const siteId = siteByDepartment.get(department);
      const hash = simulatedHash(opts.chain ?? `${ownerId}/${filename}`);
      const lastModified = daysAgo(now, modifiedAgo);

      let odFolder = null;
      let spFolder = null;
      if (location === 'OneDrive') odFolder = odFolderId.get(`${ownerId}/${folder}`);
      else spFolder = siteFolderId.get(`${siteId}/${opts.migratedDaysAgo !== undefined ? MOVED_FOLDER : folder}`);
      if (!odFolder && !spFolder) throw new Error(`Unknown folder '${folder}' for ${filename}`);

      const { lastInsertRowid } = q.file.run(filename, location, sizeMb, ownerId, department, shares,
        lastModified, hash, odFolder, spFolder);

      if (opts.migratedDaysAgo !== undefined) {
        const at = daysAgo(now, opts.migratedDaysAgo);
        const est = estimateMigration({ size_mb: sizeMb, times_shared: shares, last_modified: lastModified }, c, new Date(at));
        q.log.run(ownerId, Number(lastInsertRowid), siteId, sizeMb,
          est.total.co2_g.low, est.total.co2_g.high, est.total.kwh.low, est.total.kwh.high, at);
        telemetry.record({ department, event: 'migrate', at, mbMoved: sizeMb, estimate: est.total });
        migrations += 1;
      }
    }

    // 5. Aggregated mail metadata + historical Smart Alert outcomes
    for (const [department, monthsAgo, size, recipients] of MAIL_ATTACHMENTS) {
      q.mail.run(department, monthKey(now, monthsAgo), size, recipients);
    }
    for (const [department, ago, size, recipients, decision] of PAST_MAIL_DECISIONS) {
      const est = estimateAttachmentCloning({ sizeMb: size, recipients }, c);
      telemetry.record({
        department,
        event: decision === 'share_link' ? 'mail_share_link' : 'mail_send_anyway',
        at: daysAgo(now, ago),
        storageFreedMb: decision === 'share_link' ? est.duplicate_mb : 0,
        estimate: decision === 'share_link' ? est.annual : undefined,
      });
    }

    return { users: USERS.length, sites: SITES.length, files: FILES.length, migrations };
  });
}

// --- CLI entry point (only when executed directly: `node backend/db/seed.js`) -------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase(config.dbPath);
  const counts = seedDatabase(db);
  db.close();
  console.log(`[seed] Database: ${config.dbPath}`);
  console.log(`[seed] ${counts.users} users, ${counts.sites} SharePoint sites, ${counts.files} files, ${counts.migrations} historical migrations.`);
}
