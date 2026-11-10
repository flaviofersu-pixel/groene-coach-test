/**
 * @file impactService.js
 * @description Feature C: the metaphor dashboard (collective impact).
 *
 * PER TEAM, NOT PER DEPARTMENT: many people do not know which "afdeling" they
 * belong to, but they do recognise their teams in Microsoft Teams. A saving
 * counts for the team the document was moved TO (its team site). Savings
 * without a team (duplicate clean-up, mail links) only count in the
 * organisation total.
 *
 * PRIVACY RULES ENFORCED HERE
 *  - Organisation and team figures come ONLY from `telemetry_daily`
 *    (aggregates without user ids).
 *  - A team is only shown when it has >= config.minGroupSize members;
 *    smaller teams are merged into "Overige teams" (k-anonymity).
 *  - Personal figures come from the user's own audit rows and are returned
 *    only to that same user (token subject). There is no endpoint to query
 *    another person, and no individual leaderboard.
 *
 * All figures are yearly savings presented as bands.
 *
 * TODO(teams): the user's teams come from GET /me/joinedTeams (Team.ReadBasic.All).
 * The member count for the k-anonymity rule needs GET /groups/{id}/members/$count
 * (GroupMember.Read.All, broader than minimal); alternative without that scope:
 * only show a team once it has at least N actions. Per CHANNEL
 * (/teams/{id}/channels, Channel.ReadBasic.All) was considered and rejected:
 * smaller groups are easier to trace back to one person.
 */

import { config } from '../config.js';
import {
  band, addBands, cumulativeCloningWaste,
  storageGramsPerGbYear, networkGramsPerGb,
} from './co2Calculator.js';
import { presentEstimate, round } from './present.js';

const OTHER = 'Overige teams';

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
      SELECT team_site_id, event, SUM(count) AS count, SUM(mb_moved) AS mb_moved, SUM(storage_freed_mb) AS storage_freed_mb,
             SUM(co2_low_g) AS co2_low, SUM(co2_high_g) AS co2_high, SUM(kwh_low) AS kwh_low, SUM(kwh_high) AS kwh_high,
             SUM(dc_kwh_low) AS dc_low, SUM(dc_kwh_high) AS dc_high
      FROM telemetry_daily GROUP BY team_site_id, event`),
    // Every team (= team site) with its member count and whether the user is in it.
    teams: db.prepare(`
      SELECT s.id, s.display_name AS name, COUNT(m.user_id) AS members, MAX(m.user_id = ?) AS is_mine
      FROM sharepoint_sites s LEFT JOIN site_memberships m ON m.site_id = s.id
      GROUP BY s.id`),
    personal: db.prepare(`
      SELECT action, COUNT(*) AS n, SUM(size_mb) AS mb, SUM(storage_freed_mb) AS freed,
             SUM(co2_low_g) AS co2_low, SUM(co2_high_g) AS co2_high, SUM(kwh_low) AS kwh_low, SUM(kwh_high) AS kwh_high
      FROM migration_log WHERE user_id = ? GROUP BY action`),
    mail: db.prepare('SELECT department, size_mb, recipient_count FROM mail_attachment_stats'),
    metrics: db.prepare('SELECT * FROM co2_metrics ORDER BY rowid'),
  };

  /** Empty accumulator for one group (organisation or team). */
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

  /** Accumulator -> API shape with formatted bands. */
  function present(acc) {
    const clamp = (b) => band(Math.max(0, b.low), Math.max(0, b.high));
    return {
      ...presentEstimate({ co2_g: clamp(acc.co2), kwh: clamp(acc.kwh) }, c),
      migrations: acc.migrations,
      duplicates_recycled: acc.duplicates_recycled - acc.restores,
      mail_links: acc.mail_links,
      mail_send_anyway: acc.mail_send_anyway,
      snoozes: acc.snoozes,
      shortcuts: acc.shortcuts,
      mb_moved: round(acc.mb_moved, 1),
      storage_freed_mb: round(Math.max(0, acc.storage_freed_mb), 1),
      storage_avoided_mb: round(acc.storage_avoided_mb, 1),
    };
  }

  return {
    /** GET /api/stats/impact */
    getImpact(actor) {
      const teams = new Map(q.teams.all(actor.sub).map((t) => [t.id, { ...t, is_mine: t.is_mine === 1 }]));
      const visible = (team) => team !== undefined && team.members >= config.minGroupSize;

      // One pass over the aggregated counters: organisation, every team, and "my teams".
      const org = emptyAcc();
      const mine = emptyAcc();
      const byTeam = new Map(); // shown name -> accumulator
      for (const row of q.telemetry.all()) {
        accumulate(org, row);
        if (!row.team_site_id) continue; // no team: organisation total only
        const team = teams.get(row.team_site_id);
        const key = visible(team) ? team.name : OTHER;
        if (!byTeam.has(key)) byTeam.set(key, emptyAcc());
        accumulate(byTeam.get(key), row);
        if (visible(team) && team.is_mine) accumulate(mine, row);
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

      // Cumulative attachment cloning (Rick van Kersbergen rule), organisation-wide.
      const w = cumulativeCloningWaste(q.mail.all(), c);
      const emailCloning = {
        attachments: w.attachments,
        recipients_total: w.recipients_total,
        average_amplification: round(w.average_amplification, 1),
        duplicate_mb: round(w.duplicate_mb, 1),
        ...presentEstimate(w.annual, c),
      };

      const myTeams = [...teams.values()].filter((t) => t.is_mine && visible(t));
      const isMineName = new Set(myTeams.map((t) => t.name));

      const teamRows = [...byTeam.entries()]
        .map(([name, acc]) => {
          const shown = present(acc);
          return {
            name,
            is_mine: isMineName.has(name),
            actions: shown.migrations,
            co2_per_year: shown.co2_per_year,
            _co2: acc.co2,
          };
        })
        .sort((a, b) => b._co2.high - a._co2.high)
        .map(({ _co2, ...t }) => ({ ...t, co2_low_g: round(Math.max(0, _co2.low), 2), co2_high_g: round(Math.max(0, _co2.high), 2) }));

      return {
        period: 'per jaar',
        personal: {
          ...presentEstimate({ co2_g: clamp(p.co2), kwh: clamp(p.kwh) }, c),
          actions: p.actions,
          mb_moved: round(p.mb_moved, 1),
          storage_freed_mb: round(Math.max(0, p.storage_freed_mb), 1),
        },
        my_teams: myTeams.length
          ? { team_count: myTeams.length, ...present(mine) }
          : { team_count: 0, suppressed: true, reason: `Je teams hebben minder dan ${config.minGroupSize} leden: niet getoond om herleidbaarheid te voorkomen.` },
        organisation: { ...present(org), email_cloning: emailCloning },
        teams: teamRows,
        privacy: {
          min_group_size: config.minGroupSize,
          note: 'Team- en gemeentecijfers zijn opgeteld zonder namen. Een verhuizing telt mee bij het team waar het document naartoe gaat. Jouw persoonlijke cijfers zijn alleen voor jou zichtbaar.',
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
