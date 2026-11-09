/**
 * @file seed.js
 * @description Fills the "Microsoft Graph Mock Database" with demo data.
 *
 * Usage:
 *   npm run seed            -> wipes and re-seeds data/m365-mock.db
 *
 * The module also exports `seedDatabase()` so the server (first start) and the
 * automated tests can seed an existing connection.
 */

import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { openDatabase, inTransaction } from './database.js';
import { USERS, FILES, PAST_DECLINES } from './seedData.js';
import { calculateMigrationSavings } from '../services/co2Calculator.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {Date} now @param {number} days @returns {string} ISO timestamp `days` before `now`. */
const daysAgo = (now, days) => new Date(now.getTime() - days * DAY_MS).toISOString();

/**
 * Removes all rows and inserts the demo dataset in one transaction.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: Date }} [options] Reference "today" (injectable for tests).
 * @returns {{ users: number, files: number, migrations: number }} Row counts.
 */
export function seedDatabase(db, { now = new Date() } = {}) {
  return inTransaction(db, () => {
    // Delete children before parents to satisfy foreign keys.
    db.exec(`
      DELETE FROM coaching_decisions;
      DELETE FROM migrations;
      DELETE FROM files;
      DELETE FROM users;
      DELETE FROM sqlite_sequence;
    `);

    const insertUser = db.prepare(
      'INSERT INTO users (id, display_name, email, department) VALUES (?, ?, ?, ?)'
    );
    const insertFile = db.prepare(`
      INSERT INTO files (filename, current_location, file_size_mb, share_count,
                         last_accessed_date, owner_department, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMigration = db.prepare(`
      INSERT INTO migrations (file_id, migrated_by_user_id, department, file_size_mb, share_count,
                              energy_kwh_saved_per_year, co2_grams_saved_per_year, migrated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertDecision = db.prepare(
      'INSERT INTO coaching_decisions (file_id, user_id, decision, decided_at) VALUES (?, ?, ?, ?)'
    );

    const departmentOf = new Map(USERS.map((u) => [u.id, u.department]));
    for (const u of USERS) insertUser.run(u.id, u.display_name, u.email, u.department);

    const fileIdByName = new Map();
    let migrations = 0;

    for (const [filename, location, sizeMb, shares, accessedDaysAgo, ownerId, migratedDaysAgo] of FILES) {
      const department = departmentOf.get(ownerId);
      const { lastInsertRowid } = insertFile.run(
        filename, location, sizeMb, shares, daysAgo(now, accessedDaysAgo), department, ownerId
      );
      const fileId = Number(lastInsertRowid);
      fileIdByName.set(filename, fileId);

      // Historical migration: record the savings exactly as a live migration would.
      if (migratedDaysAgo !== undefined) {
        const savings = calculateMigrationSavings({ file_size_mb: sizeMb, share_count: shares });
        const migratedAt = daysAgo(now, migratedDaysAgo);
        insertMigration.run(
          fileId, ownerId, department, sizeMb, shares,
          savings.energy_kwh_saved, savings.co2_grams_saved, migratedAt
        );
        insertDecision.run(fileId, ownerId, 'migrated', migratedAt);
        migrations += 1;
      }
    }

    for (const [filename, userId, declinedDaysAgo] of PAST_DECLINES) {
      insertDecision.run(fileIdByName.get(filename), userId, 'declined', daysAgo(now, declinedDaysAgo));
    }

    return { users: USERS.length, files: FILES.length, migrations };
  });
}

// --- CLI entry point (only when executed directly: `node backend/db/seed.js`) --
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDatabase(config.dbPath);
  const counts = seedDatabase(db);
  db.close();
  console.log(`[seed] Database: ${config.dbPath}`);
  console.log(`[seed] Inserted ${counts.users} users, ${counts.files} files, ${counts.migrations} historical migrations.`);
}
