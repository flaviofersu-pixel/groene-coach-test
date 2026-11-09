/**
 * @file config.js
 * @description Central runtime configuration for the backend ("M365 Cloud Simulation").
 *
 * Every value can be overridden with an environment variable so the same code
 * runs on a developer laptop, inside the test-suite (in-memory database) and on
 * the municipal test VM without code changes.
 *
 * SECURITY NOTE: the server binds to 127.0.0.1 by default, so the simulated
 * Graph API is only reachable from the VM itself. Set API_HOST=0.0.0.0 only if
 * you deliberately want to reach it from another machine on an isolated network.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the project root (one level above /backend). */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = Object.freeze({
  /** TCP port of the REST API. */
  port: Number(process.env.API_PORT) || 3001,

  /** Network interface the REST API binds to (loopback = local VM only). */
  host: process.env.API_HOST || '127.0.0.1',

  /**
   * Location of the SQLite "Microsoft Graph Mock Database".
   * The tool ONLY reads/writes this single database file. It never scans or
   * touches any other part of the host/VM file system (privacy requirement).
   * Use DB_PATH=':memory:' for throw-away databases (automated tests).
   */
  dbPath: process.env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'm365-mock.db'),

  /**
   * A OneDrive file is a migration candidate ("heavily shared") when
   * share_count is strictly greater than this value (brief: share_count > 2).
   */
  shareThreshold: 2,

  /**
   * After a user clicks "Nu niet" the file is not suggested again for this
   * many days, so the coach never nags (user autonomy).
   */
  snoozeDays: 7,

  /** Simulated signed-in user when the frontend does not specify one. */
  defaultUserId: 'u01',
});
