/**
 * @file database.js
 * @description Connection management for the SQLite "Microsoft Graph Mock Database".
 *
 * Uses Node.js' built-in `node:sqlite` module (Node >= 22.13), so no native
 * driver has to be compiled on the VM and there are no extra dependencies.
 *
 * File-system scope: this module only creates the /data directory and
 * opens the single database file configured in config.dbPath. It never reads
 * any other location on the host (privacy/compliance requirement).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

/**
 * Opens (or creates) the database and makes sure the schema exists.
 *
 * @param {string} dbPath Path to the SQLite file, or ':memory:' for tests.
 * @returns {DatabaseSync} A synchronous SQLite connection.
 */
export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // Enforce REFERENCES clauses (SQLite has them off by default).
  db.exec('PRAGMA foreign_keys = ON;');
  // Write-ahead logging allows reads while a write is in progress.
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');

  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

/**
 * Runs `work` inside a single SQL transaction. Commits when `work` returns and
 * rolls back when it throws, so a migration can never be half-applied (e.g.
 * location updated but no audit row written).
 *
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} work
 * @returns {T} Whatever `work` returns.
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

/**
 * @param {DatabaseSync} db
 * @returns {boolean} True when no files have been seeded yet.
 */
export function isEmpty(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM files').get().n === 0;
}
