/**
 * @file telemetry.js
 * @description Privacy-preserving impact telemetry.
 *
 * PRIVACY BY DESIGN (AVG/GDPR art. 25): events are aggregated at write time
 * into one counter row per day x department x team x event type. The function
 * signature does not even accept a user id, so personal data cannot end up
 * in this table by accident. Dashboards for the organisation read only these
 * aggregates.
 */

/**
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createTelemetry(db) {
  const upsert = db.prepare(`
    INSERT INTO telemetry_daily (day, department, team_site_id, event, count, mb_moved, storage_freed_mb,
                                 co2_low_g, co2_high_g, kwh_low, kwh_high, dc_kwh_low, dc_kwh_high)
    VALUES (:day, :department, :team, :event, 1, :mb, :freed, :co2Low, :co2High, :kwhLow, :kwhHigh, :dcLow, :dcHigh)
    ON CONFLICT (day, department, team_site_id, event) DO UPDATE SET
      count            = count + 1,
      mb_moved         = mb_moved + excluded.mb_moved,
      storage_freed_mb = storage_freed_mb + excluded.storage_freed_mb,
      co2_low_g        = co2_low_g + excluded.co2_low_g,
      co2_high_g       = co2_high_g + excluded.co2_high_g,
      kwh_low          = kwh_low + excluded.kwh_low,
      kwh_high         = kwh_high + excluded.kwh_high,
      dc_kwh_low       = dc_kwh_low + excluded.dc_kwh_low,
      dc_kwh_high      = dc_kwh_high + excluded.dc_kwh_high`);

  return {
    /**
     * Adds one event to the aggregate counters.
     * @param {object} e
     * @param {string} e.department      organisational unit (never a person)
     * @param {string} [e.teamSiteId]    team the saving counts for (the destination team site); '' = none
     * @param {string} e.event           see CHECK constraint in schema.sql
     * @param {string} [e.at]            ISO timestamp (defaults to now)
     * @param {number} [e.mbMoved]
     * @param {number} [e.storageFreedMb]
     * @param {{ co2_g: {low:number,high:number}, kwh: {low:number,high:number}, dc_kwh: {low:number,high:number} }} [e.estimate]
     */
    record({ department, teamSiteId = '', event, at = new Date().toISOString(), mbMoved = 0, storageFreedMb = 0, estimate }) {
      upsert.run({
        day: at.slice(0, 10),
        department,
        team: teamSiteId,
        event,
        mb: mbMoved,
        freed: storageFreedMb,
        co2Low: estimate?.co2_g.low ?? 0,
        co2High: estimate?.co2_g.high ?? 0,
        kwhLow: estimate?.kwh.low ?? 0,
        kwhHigh: estimate?.kwh.high ?? 0,
        dcLow: estimate?.dc_kwh.low ?? 0,
        dcHigh: estimate?.dc_kwh.high ?? 0,
      });
    },
  };
}
