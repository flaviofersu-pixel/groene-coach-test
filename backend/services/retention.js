/**
 * @file retention.js
 * @description Storage limitation (AVG/GDPR art. 5(1)(e)): personal functional
 * data is removed as soon as it is no longer needed.
 *
 *  - snoozes        -> removed when the snooze expires (7 days)
 *  - migration_log  -> removed after config.auditRetentionDays (365 days)
 *
 * Note the contrast with the Archiefwet: PERSONAL TELEMETRY is purged, but
 * DRIVE ITEMS (the municipality's records) are never deleted by this tool.
 */

import { config } from '../config.js';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {Date} [now]
 * @returns {{ snoozes: number, auditRows: number }} rows removed
 */
export function purgeExpiredPersonalData(db, now = new Date()) {
  const auditCutoff = new Date(now.getTime() - config.auditRetentionDays * 86_400_000).toISOString();
  const snoozes = db.prepare('DELETE FROM snoozes WHERE until <= ?').run(now.toISOString()).changes;
  const auditRows = db.prepare('DELETE FROM migration_log WHERE at < ?').run(auditCutoff).changes;
  return { snoozes: Number(snoozes), auditRows: Number(auditRows) };
}
