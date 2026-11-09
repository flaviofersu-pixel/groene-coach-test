/**
 * @file impactService.js
 * @description Feature C: the metaphor dashboard (collective impact).
 *
 * PRIVACY RULES ENFORCED HERE
 *  - Organisation and department figures come ONLY from `telemetry_daily`
 *    (aggregates without user ids).
 *  - A department is only shown when it has >= config.minGroupSize members;
 *    smaller units are merged into "Overige afdelingen" (k-anonymity).
 *  - Personal figures come from the user's own audit rows and are returned
 *    only to that same user (token subject). There is no endpoint to query
 *    another person, and no individual leaderboard.
 *
 * All figures are yearly savings presented as bands.
 */

import { config } from '../config.js';
import {
  band, addBands, equivalents, cumulativeCloningWaste, formatBand,
  storageGramsPerGbYear, networkGramsPerGb,
} from './co2Calculator.js';
import { presentEstimate, round } from './present.js';

const OTHER = 'Overige afdelingen';

/** Events that represent a saving (restore is subtracted). */
const SAVING_EVENTS = new Set(['migrate', 'recycle_duplicate', 'mail_share_link']);

/**
 * @param {object} deps
 * @param {import('node:sqlite').DatabaseSync} deps.db
 * @param {Readonly<Record<string, {low:number, high:number}>>} deps.coefficients
 */
export function createImpactService({ db, coefficients: c }) {
  const q = {
    telemetry: db.prepare(`
      SELECT department, event, SUM(count) AS count, SUM(mb_moved) AS mb_moved, SUM(storage_freed_mb) AS storage_freed_mb,
             SUM(co2_low_g) AS co2_low, SUM(co2_high_g) AS co2_high, SUM(kwh_low) AS kwh_low, SUM(kwh_high) AS kwh_high,
             SUM(dc_kwh_low) AS dc_low, SUM(dc_kwh_high) AS dc_high
      FROM telemetry_daily GROUP BY department, event`),
    members: db.prepare('SELECT department, COUNT(*) AS n FROM users GROUP BY department'),
    personal: db.prepare(`
      SELECT action, COUNT(*) AS n, SUM(size_mb) AS mb, SUM(storage_freed_mb) AS freed,
             SUM(co2_low_g) AS co2_low, SUM(co2_high_g) AS co2_high, SUM(kwh_low) AS kwh_low, SUM(kwh_high) AS kwh_high
      FROM migration_log WHERE user_id = ? GROUP BY action`),
    mail: db.prepare('SELECT department, size_mb, recipient_count FROM mail_attachment_stats'),
    metrics: db.prepare('SELECT * FROM co2_metrics ORDER BY rowid'),
  };

  /** Empty accumulator for one group (organisation or department). */
  const emptyAcc = () => ({
    migrations: 0, duplicates_recycled: 0, restores: 0, mail_links: 0, mail_send_anyway: 0, snoozes: 0, shortcuts: 0,
    mb_moved: 0, storage_freed_mb: 0, storage_avoided_mb: 0, co2: band(0), kwh: band(0), dc_kwh: band(0),
  });

  /** Adds one telemetry row into an accumulator (restore counts negative). */
  function accumulate(acc, row) {
    const counters = {
      migrate: 'migrations', recycle_duplicate: 'duplicates_recycled', restore: 'restores',
      mail_share_link: 'mail_links', mail_send_anyway: 'mail_send_anyway', snooze: 'snoozes', shortcut_mapped: 'shortcuts',
    };
    acc[counters[row.event]] += row.count;
    const sign = row.event === 'restore' ? -1 : SAVING_EVENTS.has(row.event) ? 1 : 0;
    if (sign === 0) return;
    acc.mb_moved += sign * row.mb_moved;
    // A shared link AVOIDS mailbox clones; recycling duplicates FREES existing storage.
    if (row.event === 'mail_share_link') acc.storage_avoided_mb += row.storage_freed_mb;
    else acc.storage_freed_mb += sign * row.storage_freed_mb;
    acc.co2 = addBands(acc.co2, band(sign * row.co2_low, sign * row.co2_high));
    acc.kwh = addBands(acc.kwh, band(sign * row.kwh_low, sign * row.kwh_high));
    acc.dc_kwh = addBands(acc.dc_kwh, band(sign * row.dc_low, sign * row.dc_high));
  }

  /** Accumulator -> API shape with formatted bands and metaphors. */
  function present(acc) {
    const clamp = (b) => band(Math.max(0, b.low), Math.max(0, b.high));
    const eq = equivalents({ kwh: clamp(acc.kwh), dc_kwh: clamp(acc.dc_kwh) }, c);
    return {
      ...presentEstimate({ co2_g: clamp(acc.co2), kwh: clamp(acc.kwh) }),
      migrations: acc.migrations,
      duplicates_recycled: acc.duplicates_recycled - acc.restores,
      mail_links: acc.mail_links,
      mail_send_anyway: acc.mail_send_anyway,
      snoozes: acc.snoozes,
      shortcuts: acc.shortcuts,
      mb_moved: round(acc.mb_moved, 1),
      storage_freed_mb: round(Math.max(0, acc.storage_freed_mb), 1),
      storage_avoided_mb: round(acc.storage_avoided_mb, 1),
      equivalents: {
        lamp_hours: formatBand(eq.lamp_hours, 'count'),
        cooling_kwh: formatBand(eq.cooling_kwh, 'kwh'),
      },
    };
  }

  return {
    /** GET /api/stats/impact */
    getImpact(actor) {
      const members = new Map(q.members.all().map((r) => [r.department, r.n]));
      const visible = (dept) => (members.get(dept) ?? 0) >= config.minGroupSize;

      const org = emptyAcc();
      const byDept = new Map();
      for (const row of q.telemetry.all()) {
        accumulate(org, row);
        const key = visible(row.department) ? row.department : OTHER;
        if (!byDept.has(key)) byDept.set(key, emptyAcc());
        accumulate(byDept.get(key), row);
      }

      // Personal: own audit rows only (restore subtracts).
      const p = { actions: 0, mb_moved: 0, storage_freed_mb: 0, co2: band(0), kwh: band(0) };
      for (const r of q.personal.all(actor.sub)) {
        const sign = r.action === 'restore' ? -1 : 1;
        p.actions += r.action === 'restore' ? 0 : r.n;
        if (r.action === 'migrate') p.mb_moved += r.mb;
        p.storage_freed_mb += sign * r.freed;
        p.co2 = addBands(p.co2, band(sign * r.co2_low, sign * r.co2_high));
        p.kwh = addBands(p.kwh, band(sign * r.kwh_low, sign * r.kwh_high));
      }
      const clamp = (b) => band(Math.max(0, b.low), Math.max(0, b.high));

      // Cumulative attachment cloning (Rick van Kersbergen rule).
      const mailRows = q.mail.all();
      const mailWaste = (rows) => {
        const w = cumulativeCloningWaste(rows, c);
        return {
          attachments: w.attachments,
          recipients_total: w.recipients_total,
          average_amplification: round(w.average_amplification, 1),
          duplicate_mb: round(w.duplicate_mb, 1),
          ...presentEstimate(w.annual),
        };
      };

      const departments = [...byDept.entries()]
        .map(([name, acc]) => {
          const shown = present(acc);
          return {
            name,
            is_mine: name === actor.department,
            actions: shown.migrations + shown.duplicates_recycled + shown.mail_links,
            co2_per_year: shown.co2_per_year,
            _co2: acc.co2,
          };
        })
        .sort((a, b) => b._co2.high - a._co2.high)
        .map(({ _co2, ...d }) => ({ ...d, co2_low_g: round(Math.max(0, _co2.low), 2), co2_high_g: round(Math.max(0, _co2.high), 2) }));

      return {
        period: 'per jaar',
        personal: {
          ...presentEstimate({ co2_g: clamp(p.co2), kwh: clamp(p.kwh) }),
          actions: p.actions,
          mb_moved: round(p.mb_moved, 1),
          storage_freed_mb: round(Math.max(0, p.storage_freed_mb), 1),
        },
        department: visible(actor.department)
          ? { name: actor.department, members: members.get(actor.department), ...present(byDept.get(actor.department) ?? emptyAcc()),
            email_cloning: mailWaste(mailRows.filter((r) => r.department === actor.department)) }
          : { name: actor.department, suppressed: true, reason: `Minder dan ${config.minGroupSize} collega's: niet getoond om herleidbaarheid te voorkomen.` },
        organisation: { ...present(org), email_cloning: mailWaste(mailRows) },
        departments,
        privacy: {
          min_group_size: config.minGroupSize,
          note: 'Afdelings- en gemeentecijfers zijn geaggregeerd zonder persoonsgegevens. Jouw persoonlijke cijfers zijn alleen voor jou zichtbaar.',
        },
      };
    },

    /** GET /api/co2-metrics: the coefficient table plus engine-derived checks. */
    metrics() {
      const storage = storageGramsPerGbYear(c);
      const network = networkGramsPerGb(c);
      return {
        metrics: q.metrics.all(),
        engine_check: {
          storage_g_per_gb_year: { low: round(storage.low, 3), high: round(storage.high, 3) },
          network_sync_g_per_gb: { low: round(network.low, 3), high: round(network.high, 3) },
        },
      };
    },
  };
}
