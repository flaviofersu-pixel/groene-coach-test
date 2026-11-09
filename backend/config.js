/**
 * @file config.js
 * @description Central runtime configuration for the backend ("M365 tenant simulation").
 *
 * Every value can be overridden with an environment variable, so the same code
 * runs on a laptop, inside the test-suite (in-memory database) and on the
 * municipal test VM without code changes ("12-factor" configuration pattern).
 *
 * SECURITY NOTES
 *  - The API binds to 127.0.0.1 by default: only the VM itself can reach it.
 *  - The token signing secret is generated in memory at start-up when no
 *    TOKEN_SIGNING_SECRET is provided. It is never logged or written to disk.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Absolute path of the project root (one level above /backend). */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Microsoft Graph delegated permissions the Groene Coach needs, and why.
 * `Files.ReadWrite.All` is the sensitive one: moving a file out of a personal
 * OneDrive into a SharePoint library writes to two different drives.
 */
export const GRAPH_SCOPES = Object.freeze({
  USER_READ: 'User.Read',                 // profile + department of the signed-in user
  FILES_READ_ALL: 'Files.Read.All',       // scan own OneDrive incl. sharing permissions + hashes
  FILES_READWRITE_ALL: 'Files.ReadWrite.All', // move items, add shortcuts, move copies to recycle bin
  SITES_READ_ALL: 'Sites.Read.All',       // list department SharePoint sites/libraries the user belongs to
});

/** Simulated admin-consent state of the tenant (set ADMIN_CONSENT=false to demo the blocked state). */
const adminConsentGranted = process.env.ADMIN_CONSENT !== 'false';

export const config = Object.freeze({
  /** TCP port and interface of the REST API. */
  port: Number(process.env.API_PORT) || 3001,
  host: process.env.API_HOST || '127.0.0.1',

  /**
   * The ONLY file the tool reads/writes: the SQLite tenant simulation.
   * Use DB_PATH=':memory:' for throw-away databases (automated tests).
   */
  dbPath: process.env.DB_PATH || path.join(PROJECT_ROOT, 'data', 'm365-tenant-sim.db'),

  /** Action Hub rule from the brief: OneDrive files with times_shared > 2. */
  shareThreshold: 2,

  /** "Nu niet" hides a suggestion for this many days; the snooze row is then purged. */
  snoozeDays: 7,

  /**
   * Privacy: aggregated figures for a department are only shown when the
   * department has at least this many members (k-anonymity), so no number
   * can be traced back to one civil servant.
   */
  minGroupSize: 3,

  /** Personal audit-log rows (who moved what) are purged after this many days. */
  auditRetentionDays: 365,

  /** Outlook Smart Alert trigger: attachment >= minAttachmentMb sent to > recipientThreshold people. */
  mail: Object.freeze({ recipientThreshold: 2, minAttachmentMb: 0.5 }),

  /** Simulated Microsoft Entra ID / Teams SSO token settings. */
  auth: Object.freeze({
    issuer: 'https://login.microsoftonline.example/gemeente-amsterdam-sim/v2.0',
    audience: 'api://klimaattool-sim',
    tokenTtlSeconds: 15 * 60,
    signingSecret: process.env.TOKEN_SIGNING_SECRET || crypto.randomBytes(32).toString('hex'),
    adminConsentGranted,
    /**
     * Scopes present in issued tokens. Municipal tenants disable user consent,
     * so without admin consent only the basic profile scope is available.
     */
    grantedScopes: adminConsentGranted
      ? [GRAPH_SCOPES.USER_READ, GRAPH_SCOPES.FILES_READ_ALL, GRAPH_SCOPES.FILES_READWRITE_ALL, GRAPH_SCOPES.SITES_READ_ALL]
      : [GRAPH_SCOPES.USER_READ],
  }),
});
