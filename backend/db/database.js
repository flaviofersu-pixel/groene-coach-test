/**
 * @file database.js
 * @description Connection management for the SQLite tenant simulation.
 *
 * Uses Node.js' built-in `node:sqlite` module (Node >= 22.13): no native driver
 * to compile on the VM and no extra dependency.
 *
 * File-system scope: this module only creates the /data directory and opens
 * the single database file from config.dbPath. It never reads any other
 * location on the host (privacy/compliance requirement).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

/** Tables in child-before-parent order (used when resetting). */
const TABLES = [
  'telemetry_daily', 'mail_attachment_stats', 'migration_log', 'snoozes', 'files',
  'onedrive_items', 'sharepoint_folders', 'site_memberships', 'users', 'sharepoint_sites', 'co2_metrics',
];

/**
 * Opens (or creates) the database and makes sure the schema exists.
 * @param {string} dbPath Path to the SQLite file, or ':memory:' for tests.
 * @returns {DatabaseSync}
 */
export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');                       // enforce REFERENCES
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;'); // reads during writes
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

/**
 * Drops and recreates every table. Only the seed script calls this: it is the
 * one place where data disappears, and only demo data is involved. (DROP TABLE
 * does not fire the "never delete" trigger on `files`.)
 * @param {DatabaseSync} db
 */
export function resetSchema(db) {
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const table of TABLES) db.exec(`DROP TABLE IF EXISTS ${table};`);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

/**
 * Runs `work` inside one SQL transaction: commit on return, rollback on throw.
 * Guarantees that e.g. a move, its audit row and its telemetry are all-or-nothing.
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} work
 * @returns {T}
 */
export function inTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** @param {DatabaseSync} db @returns {boolean} True when nothing has been seeded yet. */
export function isEmpty(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM files').get().n === 0;
}

/**
 * Version of the demo data model. Raise this number whenever schema.sql or the
 * seed data changes in a way an existing database cannot follow (new table
 * column, new required CO2 factor). The server then rebuilds the DEMO database
 * on start. SQLite keeps the number in the file header (`PRAGMA user_version`).
 */
export const DEMO_DATA_VERSION = 4;

/** Stamps the database with the current demo data version (called by the seed). */
export function markDemoDataVersion(db) {
  db.exec(`PRAGMA user_version = ${DEMO_DATA_VERSION}`);
}

/** @param {DatabaseSync} db @returns {boolean} True when the database was built by an older version. */
export function isOutdated(db) {
  return db.prepare('PRAGMA user_version').get().user_version !== DEMO_DATA_VERSION;
}
