/**
 * @file statsService.js
 * @description Aggregates migration results for the Teams dashboard.
 *
 * All totals come from the `migrations` table, which stores the CO2 saving
 * calculated at the moment of each migration (snapshot). Figures are YEARLY
 * savings: what the organisation avoids every year the file stays on SharePoint.
 */

import {
  calculateEquivalents, CO2_FACTORS, EQUIVALENCE_FACTORS, round,
} from './co2Calculator.js';

/**
 * Rounds an aggregate row and adds the Amsterdam equivalents.
 * @param {{ files_migrated:number, mb_migrated:number, energy_kwh:number, co2_grams:number }} row
 */
function toTotalsDto(row) {
  const eq = calculateEquivalents({ energy_kwh: row.energy_kwh, co2_grams: row.co2_grams });
  return {
    files_migrated: row.files_migrated,
    mb_migrated: round(row.mb_migrated, 1),
    energy_kwh_saved_per_year: round(row.energy_kwh, 3),
    co2_grams_saved_per_year: round(row.co2_grams, 1),
    // 4 decimals: small personal savings must not round to 0 (the frontend
    // picks a readable unit such as minutes or metres).
    equivalents: {
      streetlight_hours: round(eq.streetlight_hours, 4),
      streetlight_nights: round(eq.streetlight_nights, 4),
      tree_days: round(eq.tree_days, 4),
      trees_for_a_year: round(eq.trees_for_a_year, 4),
      car_km_avoided: round(eq.car_km_avoided, 4),
    },
  };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<import('./fileService.js').createFileService>} fileService
 */
export function createStatsService(db, fileService) {
  const AGGREGATE = `
    COUNT(m.id)                                  AS files_migrated,
    COALESCE(SUM(m.file_size_mb), 0)             AS mb_migrated,
    COALESCE(SUM(m.energy_kwh_saved_per_year), 0) AS energy_kwh,
    COALESCE(SUM(m.co2_grams_saved_per_year), 0)  AS co2_grams`;

  const stmt = {
    organisation: db.prepare(`SELECT ${AGGREGATE} FROM migrations m`),
    byUser: db.prepare(`SELECT ${AGGREGATE} FROM migrations m WHERE m.migrated_by_user_id = ?`),
    byDepartment: db.prepare(`SELECT ${AGGREGATE} FROM migrations m WHERE m.department = ?`),
    // LEFT JOIN so departments without migrations still appear (with 0).
    allDepartments: db.prepare(`
      SELECT d.department AS name, ${AGGREGATE}
      FROM (SELECT DISTINCT department FROM users) d
      LEFT JOIN migrations m ON m.department = d.department
      GROUP BY d.department
      ORDER BY co2_grams DESC, d.department`),
    departmentUserCount: db.prepare('SELECT COUNT(*) AS n FROM users WHERE department = ?'),
    decisions: db.prepare(`
      SELECT decision, COUNT(*) AS n FROM coaching_decisions WHERE user_id = ? GROUP BY decision`),
    recent: db.prepare(`
      SELECT m.file_id, f.filename, m.file_size_mb, m.share_count,
             m.co2_grams_saved_per_year, m.migrated_at
      FROM migrations m JOIN files f ON f.id = m.file_id
      WHERE m.migrated_by_user_id = ?
      ORDER BY m.migrated_at DESC
      LIMIT 5`),
  };

  return {
    /**
     * GET /api/stats/co2-saved[?user=u01]
     * Without `user`: organisation-wide totals + department ranking.
     * With `user`:    additionally the personal and department figures,
     *                 coaching statistics and remaining potential.
     *
     * @param {{ userId?: string }} [options]
     */
    getCo2Saved({ userId } = {}) {
      const response = {
        total: toTotalsDto(stmt.organisation.get()),
        departments: stmt.allDepartments.all().map((d) => ({
          name: d.name,
          files_migrated: d.files_migrated,
          mb_migrated: round(d.mb_migrated, 1),
          co2_grams_saved_per_year: round(d.co2_grams, 1),
        })),
        user: null,
        department: null,
        coaching: null,
        potential: null,
        recent_migrations: [],
        methodology: {
          period: 'per jaar',
          co2_factors: CO2_FACTORS,
          equivalence_factors: EQUIVALENCE_FACTORS,
        },
      };

      if (!userId) return response;

      const user = fileService.requireUser(userId);

      response.user = {
        id: user.id,
        display_name: user.display_name,
        department: user.department,
        ...toTotalsDto(stmt.byUser.get(user.id)),
      };

      response.department = {
        name: user.department,
        user_count: stmt.departmentUserCount.get(user.department).n,
        ...toTotalsDto(stmt.byDepartment.get(user.department)),
      };

      const counts = Object.fromEntries(stmt.decisions.all(user.id).map((r) => [r.decision, r.n]));
      const accepted = counts.migrated ?? 0;
      const declined = counts.declined ?? 0;
      response.coaching = {
        accepted,
        declined,
        acceptance_rate_percent: accepted + declined > 0 ? round((accepted / (accepted + declined)) * 100, 0) : null,
      };

      // What the user could still save (includes snoozed files: it is information, not a nudge).
      const remaining = fileService.scanOneDrive({ userId: user.id, includeSnoozed: true });
      response.potential = {
        files_remaining: remaining.count,
        co2_grams_per_year: remaining.total_potential_co2_grams_per_year,
      };

      response.recent_migrations = stmt.recent.all(user.id).map((r) => ({
        ...r,
        co2_grams_saved_per_year: round(r.co2_grams_saved_per_year, 1),
      }));

      return response;
    },
  };
}
