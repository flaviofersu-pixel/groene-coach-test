/**
 * @file fileService.js
 * @description Business logic for drive items: scanning OneDrive for heavily
 * shared files, migrating them to SharePoint and logging "Nu niet" answers.
 *
 * The service only talks to the mock database through prepared statements
 * (parameterised SQL, so no injection) and never touches the real file system.
 */

import { config } from '../config.js';
import { inTransaction } from '../db/database.js';
import { HttpError } from '../errors.js';
import { calculateMigrationSavings, LOCATIONS, round } from './co2Calculator.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Files untouched for longer than this are flagged as lifecycle/archive candidates. */
const STALE_AFTER_DAYS = 365;

/**
 * Converts the savings object of the CO2 engine into a compact, rounded API shape.
 * @param {ReturnType<typeof calculateMigrationSavings>} s
 */
export function toSavingsDto(s) {
  return {
    co2_grams_per_year: round(s.co2_grams_saved, 2),
    energy_kwh_per_year: round(s.energy_kwh_saved, 4),
    reduction_percent: round(s.reduction_percent, 1),
    breakdown: {
      storage_co2_grams: round(s.before.storage_co2_grams - s.after.storage_co2_grams, 3),
      network_co2_grams: round(s.before.network_co2_grams - s.after.network_co2_grams, 3),
      onedrive_co2_grams: round(s.before.co2_grams, 2),
      sharepoint_co2_grams: round(s.after.co2_grams, 2),
    },
  };
}

/**
 * Shapes a database row for the API (adds derived lifecycle fields).
 * @param {Record<string, any>} row
 * @param {Date} now
 */
function toFileDto(row, now) {
  const daysSinceAccess = Math.floor((now.getTime() - Date.parse(row.last_accessed_date)) / DAY_MS);
  return {
    id: row.id,
    filename: row.filename,
    current_location: row.current_location,
    file_size_mb: row.file_size_mb,
    share_count: row.share_count,
    last_accessed_date: row.last_accessed_date,
    owner_department: row.owner_department,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    days_since_access: daysSinceAccess,
    is_stale: daysSinceAccess > STALE_AFTER_DAYS,
  };
}

/**
 * Factory: binds the service to a database connection (dependency injection
 * keeps it testable with an in-memory database).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: () => Date }} [options] Clock injection for tests.
 */
export function createFileService(db, { now = () => new Date() } = {}) {
  const FILE_COLUMNS = `
    f.id, f.filename, f.current_location, f.file_size_mb, f.share_count,
    f.last_accessed_date, f.owner_department, f.owner_user_id, u.display_name AS owner_name`;

  const stmt = {
    userById: db.prepare('SELECT id, display_name, email, department FROM users WHERE id = ?'),
    allUsers: db.prepare('SELECT id, display_name, email, department FROM users ORDER BY id'),
    fileById: db.prepare(`SELECT ${FILE_COLUMNS} FROM files f JOIN users u ON u.id = f.owner_user_id WHERE f.id = ?`),
    allFiles: db.prepare(`SELECT ${FILE_COLUMNS} FROM files f JOIN users u ON u.id = f.owner_user_id ORDER BY f.id`),

    // Core rule of the brief: still in OneDrive AND shared with more than N people.
    candidates: db.prepare(`
      SELECT ${FILE_COLUMNS}
      FROM files f JOIN users u ON u.id = f.owner_user_id
      WHERE f.current_location = 'OneDrive' AND f.share_count > :threshold
      ORDER BY f.id`),

    // Files this user said "Nu niet" to within the snooze window.
    snoozedFileIds: db.prepare(`
      SELECT DISTINCT file_id FROM coaching_decisions
      WHERE user_id = :userId AND decision = 'declined' AND decided_at > :cutoff`),

    moveToSharePoint: db.prepare(`
      UPDATE files SET current_location = 'SharePoint', last_accessed_date = :now
      WHERE id = :id AND current_location = 'OneDrive'`),
    insertMigration: db.prepare(`
      INSERT INTO migrations (file_id, migrated_by_user_id, department, file_size_mb, share_count,
                              energy_kwh_saved_per_year, co2_grams_saved_per_year, migrated_at)
      VALUES (:fileId, :userId, :department, :size, :shares, :kwh, :co2, :now)`),
    insertDecision: db.prepare(`
      INSERT INTO coaching_decisions (file_id, user_id, decision, decided_at)
      VALUES (:fileId, :userId, :decision, :now)`),
  };

  /** @param {string} userId @returns {object} the user, or throws 404. */
  function requireUser(userId) {
    const user = stmt.userById.get(userId);
    if (!user) throw new HttpError(404, `Gebruiker '${userId}' bestaat niet.`);
    return user;
  }

  /** @param {number} fileId @returns {object} the raw file row, or throws 404. */
  function requireFile(fileId) {
    const file = stmt.fileById.get(fileId);
    if (!file) throw new HttpError(404, `Bestand ${fileId} bestaat niet.`);
    return file;
  }

  return {
    requireUser,

    listUsers: () => stmt.allUsers.all(),

    /** All drive items, optionally filtered by location and/or owner. */
    listFiles({ location, userId } = {}) {
      const at = now();
      return stmt.allFiles
        .all()
        .filter((f) => (!location || f.current_location === location) && (!userId || f.owner_user_id === userId))
        .map((f) => toFileDto(f, at));
    },

    /**
     * GET /api/files/scan-onedrive
     * Returns OneDrive files with share_count > threshold, ranked by the CO2
     * that moving them would save (biggest impact first).
     *
     * @param {{ userId?: string, includeSnoozed?: boolean }} [options]
     *   userId         - only files owned by this user (what the desktop widget shows)
     *   includeSnoozed - also return files the user recently answered "Nu niet" to
     */
    scanOneDrive({ userId, includeSnoozed = false } = {}) {
      const at = now();
      let rows = stmt.candidates.all({ threshold: config.shareThreshold });
      let snoozedCount = 0;

      if (userId) {
        requireUser(userId);
        rows = rows.filter((r) => r.owner_user_id === userId);

        if (!includeSnoozed) {
          const cutoff = new Date(at.getTime() - config.snoozeDays * DAY_MS).toISOString();
          const snoozed = new Set(stmt.snoozedFileIds.all({ userId, cutoff }).map((r) => r.file_id));
          snoozedCount = rows.filter((r) => snoozed.has(r.id)).length;
          rows = rows.filter((r) => !snoozed.has(r.id));
        }
      }

      const files = rows
        .map((r) => ({ ...toFileDto(r, at), projected_savings: toSavingsDto(calculateMigrationSavings(r)) }))
        .sort((a, b) => b.projected_savings.co2_grams_per_year - a.projected_savings.co2_grams_per_year);

      return {
        threshold: config.shareThreshold,
        user_id: userId ?? null,
        count: files.length,
        snoozed_count: snoozedCount,
        total_potential_co2_grams_per_year: round(
          files.reduce((sum, f) => sum + f.projected_savings.co2_grams_per_year, 0), 2
        ),
        files,
      };
    },

    /**
     * POST /api/files/migrate-to-sharepoint
     * Moves a file from OneDrive to SharePoint and records the CO2 saving.
     * Location change, migration row and audit row are written atomically.
     *
     * @param {{ fileId: number, userId?: string }} input
     *   userId defaults to the file owner. If given, it MUST be the owner:
     *   nobody can move a file out of someone else's personal OneDrive.
     */
    migrateToSharePoint({ fileId, userId }) {
      const file = requireFile(fileId);
      const actingUserId = userId ?? file.owner_user_id;
      const user = requireUser(actingUserId);

      if (user.id !== file.owner_user_id) {
        throw new HttpError(403, 'Alleen de eigenaar kan dit bestand verhuizen.');
      }
      if (file.current_location === LOCATIONS.SHAREPOINT) {
        throw new HttpError(409, 'Dit bestand staat al op SharePoint.');
      }

      const savings = calculateMigrationSavings(file);
      const timestamp = now().toISOString();

      inTransaction(db, () => {
        const { changes } = stmt.moveToSharePoint.run({ id: file.id, now: timestamp });
        // Guards against a race where two requests migrate the same file.
        if (changes !== 1) throw new HttpError(409, 'Dit bestand staat al op SharePoint.');

        stmt.insertMigration.run({
          fileId: file.id, userId: user.id, department: user.department,
          size: file.file_size_mb, shares: file.share_count,
          kwh: savings.energy_kwh_saved, co2: savings.co2_grams_saved, now: timestamp,
        });
        stmt.insertDecision.run({ fileId: file.id, userId: user.id, decision: 'migrated', now: timestamp });
      });

      return {
        file: toFileDto(requireFile(file.id), now()),
        savings: toSavingsDto(savings),
        migrated_by: { id: user.id, display_name: user.display_name, department: user.department },
        migrated_at: timestamp,
      };
    },

    /**
     * POST /api/files/decline
     * Logs that the user chose "Nu niet". The file stays exactly where it is,
     * and it is not suggested again during the snooze window.
     *
     * @param {{ fileId: number, userId?: string }} input
     */
    declineMigration({ fileId, userId }) {
      const file = requireFile(fileId);
      const user = requireUser(userId ?? file.owner_user_id);
      const at = now();

      stmt.insertDecision.run({ fileId: file.id, userId: user.id, decision: 'declined', now: at.toISOString() });
      console.log(`[coaching] ${user.id} chose "Nu niet" for file ${file.id} (${file.filename}); file stays in ${file.current_location}.`);

      return {
        file_id: file.id,
        decision: 'declined',
        current_location: file.current_location,
        snoozed_until: new Date(at.getTime() + config.snoozeDays * DAY_MS).toISOString(),
      };
    },
  };
}
