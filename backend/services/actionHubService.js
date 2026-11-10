/**
 * @file actionHubService.js
 * @description Business logic behind the Teams "Actie-hub".
 *
 *  - scanOneDrive          Feature A: own OneDrive files with times_shared > 2
 *  - duplicateChains       bit-identical copies (same content hash) involving the user
 *  - migrateToSharePoint   "Ja, verhuis het"
 *  - snooze                "Nu niet" (hidden for 7 days, then purged)
 *  - consolidateDuplicates user-confirmed clean-up of OWN redundant copies -> recycle bin
 *  - restore               undo a clean-up (Archiefwet safety net)
 *
 * The service orchestrates; the Graph gateway performs and authorises the
 * actual drive operations. Each user action is one SQL transaction: drive
 * change + personal audit row + aggregated telemetry, all or nothing.
 *
 * AUTONOMY: nothing here runs without an explicit request from the user, and
 * no code path hard-deletes a file.
 */

import { config, GRAPH_SCOPES } from '../config.js';
import { inTransaction } from '../db/database.js';
import { HttpError } from '../errors.js';
import { estimateMigration, estimateDuplicateRemoval, addBands } from './co2Calculator.js';
import { presentEstimate, round } from './present.js';

const DAY_MS = 86_400_000;

/**
 * @param {object} deps
 * @param {import('node:sqlite').DatabaseSync} deps.db
 * @param {ReturnType<import('../graph/graphMock.js').createGraphMock>} deps.graph
 * @param {Readonly<Record<string, {low:number, high:number}>>} deps.coefficients
 * @param {ReturnType<import('./telemetry.js').createTelemetry>} deps.telemetry
 * @param {() => Date} deps.now
 */
export function createActionHubService({ db, graph, coefficients: c, telemetry, now }) {
  const q = {
    snoozed: db.prepare('SELECT file_id FROM snoozes WHERE user_id = ? AND until > ?'),
    upsertSnooze: db.prepare(`INSERT INTO snoozes (user_id, file_id, until) VALUES (?, ?, ?)
                              ON CONFLICT (user_id, file_id) DO UPDATE SET until = excluded.until`),
    clearSnooze: db.prepare('DELETE FROM snoozes WHERE user_id = ? AND file_id = ?'),
    departmentSite: db.prepare('SELECT id FROM sharepoint_sites WHERE department = ?'),
    chainHashes: db.prepare(`
      SELECT content_hash FROM files WHERE status = 'active'
      GROUP BY content_hash HAVING COUNT(*) >= 2 AND SUM(owner_id = ?) >= 1`),
    chainFiles: db.prepare(`
      SELECT f.*, oi.name AS od_folder, sf.name AS sp_folder, s.display_name AS site_name
      FROM files f
      LEFT JOIN onedrive_items oi     ON oi.id = f.onedrive_folder_id
      LEFT JOIN sharepoint_folders sf ON sf.id = f.sharepoint_folder_id
      LEFT JOIN sharepoint_sites s    ON s.id = sf.site_id
      WHERE f.content_hash = ? AND f.status = 'active'
      ORDER BY f.last_modified DESC, f.times_shared DESC, f.id`),
    log: db.prepare(`
      INSERT INTO migration_log (user_id, file_id, action, from_location, from_folder, to_location, to_site_id,
                                 size_mb, storage_freed_mb, co2_low_g, co2_high_g, kwh_low, kwh_high, at)
      VALUES (:user, :file, :action, :fromLoc, :fromFolder, :toLoc, :site, :size, :freed, :co2Low, :co2High, :kwhLow, :kwhHigh, :at)`),
    lastRecycleLog: db.prepare(`SELECT * FROM migration_log WHERE user_id = ? AND file_id = ? AND action = 'recycle_duplicate'
                                ORDER BY id DESC LIMIT 1`),
  };

  /** Writes one personal audit row (visible to this user only). */
  function audit(actor, { file, action, fromLocation, fromFolder, toLocation, siteId = null, estimate }) {
    q.log.run({
      user: actor.sub, file: file.id, action, fromLoc: fromLocation, fromFolder, toLoc: toLocation, site: siteId,
      size: file.size_mb, freed: estimate.storage_freed_mb ?? 0,
      co2Low: estimate.co2_g.low, co2High: estimate.co2_g.high, kwhLow: estimate.kwh.low, kwhHigh: estimate.kwh.high,
      at: now().toISOString(),
    });
  }

  /** The user's department site is the default (and legally correct) destination. */
  function defaultSiteId(actor) {
    const row = q.departmentSite.get(actor.department);
    if (!row) throw new HttpError(409, 'Er is geen SharePoint-site voor jouw afdeling gevonden.');
    return row.id;
  }

  /** Shapes a file plus its migration estimate for the client. */
  function candidateDto(file, at) {
    const est = estimateMigration(file, c, at);
    return {
      id: file.id,
      filename: file.filename,
      current_location: file.current_location,
      size_mb: file.size_mb,
      times_shared: file.times_shared,
      last_modified: file.last_modified,
      folder: file.folder_name,
      activity: est.activity,
      estimate: {
        ...presentEstimate(est.total, c),
        breakdown: {
          storage: { label: '0 gram CO₂', note: est.storage.note },
          sync: presentEstimate({ co2_g: est.sync.co2_g, kwh: est.sync.kwh }, c).co2_per_year,
          backup: presentEstimate({ co2_g: est.backup.co2_g, kwh: est.backup.kwh }, c).co2_per_year,
        },
      },
      _sortKey: est.total.co2_g.high,
    };
  }

  /** Analyses one duplicate chain from the perspective of `actor`. */
  function analyseChain(actor, hash) {
    const copies = q.chainFiles.all(hash);
    const master = copies.find((f) => f.current_location === 'SharePoint') ?? null;
    const mine = copies.filter((f) => f.owner_id === actor.sub && f.current_location === 'OneDrive');
    // Without a SharePoint master, the user's newest copy becomes the master.
    const keep = master ? null : mine[0] ?? null;
    const removable = mine.filter((f) => f !== keep);
    const size = copies[0].size_mb;
    const colleagues = new Set(copies.filter((f) => f.owner_id !== actor.sub).map((f) => f.owner_id)).size;

    return {
      copies, master, keep, removable, size, colleagues,
      dto: {
        content_hash: hash,
        filename: (master ?? mine[0] ?? copies[0]).filename,
        size_mb: size,
        total_copies: copies.length,
        // Organisation-wide waste of this chain, the honest storage figure.
        chain_waste: presentEstimate(estimateDuplicateRemoval(size, copies.length - 1, c).total, c),
        my_copies: mine.map((f) => ({ id: f.id, filename: f.filename, folder: f.od_folder })),
        colleagues_with_copy: colleagues, // a count, never names (privacy)
        master: master
          ? { location: 'SharePoint', site: master.site_name, folder: master.sp_folder, filename: master.filename }
          : null,
        removable_count: removable.length,
        can_consolidate: removable.length > 0,
        my_saving: presentEstimate(estimateDuplicateRemoval(size, removable.length, c).total, c),
      },
    };
  }

  return {
    /** Feature A: the user's OneDrive files that are intensively shared. */
    scanOneDrive(actor) {
      const at = now();
      // Expired snoozes are ignored here and purged by the retention job (server.js).
      const snoozed = new Set(q.snoozed.all(actor.sub, at.toISOString()).map((r) => r.file_id));
      const candidates = graph.listMyOneDriveFiles(actor)
        .filter((f) => f.status === 'active' && f.times_shared > config.shareThreshold);

      const files = candidates
        .filter((f) => !snoozed.has(f.id))
        .map((f) => candidateDto(f, at))
        .sort((a, b) => b._sortKey - a._sortKey)
        .map(({ _sortKey, ...dto }) => dto);

      return {
        threshold: config.shareThreshold,
        count: files.length,
        snoozed_count: candidates.length - files.length,
        files,
      };
    },

    /** All own active files (attachment picker of the Outlook simulation). */
    listMine(actor) {
      const files = graph.listMyFiles(actor);
      return { count: files.length, files };
    },

    /** Duplicate chains (same simulated quickXorHash) in which the user owns a copy. */
    duplicateChains(actor) {
      graph.requireScope(actor, GRAPH_SCOPES.FILES_READ_ALL);
      const chains = q.chainHashes.all(actor.sub).map((r) => analyseChain(actor, r.content_hash).dto);
      chains.sort((a, b) => b.size_mb * b.total_copies - a.size_mb * a.total_copies);
      return { count: chains.length, chains };
    },

    /** "Ja, verhuis het": OneDrive -> department SharePoint site. */
    migrateToSharePoint(actor, { fileId, siteId }) {
      const target = siteId ?? defaultSiteId(actor);
      const before = graph.getMyFile(actor, fileId);
      const est = estimateMigration(before, c, now());

      const result = inTransaction(db, () => {
        const moved = graph.moveToSharePoint(actor, fileId, target);
        audit(actor, {
          file: moved.file, action: 'migrate', fromLocation: 'OneDrive', fromFolder: moved.fromFolder,
          toLocation: 'SharePoint', siteId: moved.site.id, estimate: est.total,
        });
        q.clearSnooze.run(actor.sub, fileId);
        telemetry.record({ department: actor.department, event: 'migrate', mbMoved: before.size_mb, estimate: est.total });
        return moved;
      });

      return {
        file: { id: result.file.id, filename: result.file.filename, current_location: result.file.current_location },
        site: { id: result.site.id, display_name: result.site.display_name, web_url: result.site.web_url },
        estimate: presentEstimate(est.total, c),
        storage_note: est.storage.note,
      };
    },

    /** "Nu niet": the file stays where it is; the suggestion is hidden for a while. */
    snooze(actor, { fileId }) {
      const file = graph.getMyFile(actor, fileId); // scope + ownership check
      const until = new Date(now().getTime() + config.snoozeDays * DAY_MS).toISOString();
      inTransaction(db, () => {
        q.upsertSnooze.run(actor.sub, file.id, until);
        telemetry.record({ department: actor.department, event: 'snooze' });
      });
      return { file_id: file.id, current_location: file.current_location, snoozed_until: until };
    },

    /**
     * User-confirmed clean-up of the user's OWN redundant copies in a chain.
     *  - If no SharePoint master exists, the newest own copy is moved there first.
     *  - The other own copies go to the RECYCLE BIN (restorable), never deleted.
     *  - Colleagues' copies are never touched; we only report how many exist.
     */
    consolidateDuplicates(actor, { contentHash, confirmed }) {
      if (confirmed !== true) {
        throw new HttpError(400, 'Bevestiging ontbreekt: opruimen gebeurt alleen na jouw expliciete akkoord.');
      }
      graph.requireScope(actor, GRAPH_SCOPES.FILES_READWRITE_ALL);
      const chain = analyseChain(actor, contentHash);
      if (!chain.copies.some((f) => f.owner_id === actor.sub)) throw new HttpError(404, 'Deze reeks kopieën is niet gevonden.');
      if (chain.removable.length === 0) throw new HttpError(409, 'Je hebt in deze reeks geen overbodige kopieën.');

      const removal = estimateDuplicateRemoval(chain.size, chain.removable.length, c).total;
      const perCopy = estimateDuplicateRemoval(chain.size, 1, c).total;

      const outcome = inTransaction(db, () => {
        let master = chain.master;
        let moveEstimate = null;
        if (!master) {
          moveEstimate = estimateMigration(chain.keep, c, now()).total;
          const moved = graph.moveToSharePoint(actor, chain.keep.id, defaultSiteId(actor));
          audit(actor, { file: moved.file, action: 'migrate', fromLocation: 'OneDrive', fromFolder: moved.fromFolder,
            toLocation: 'SharePoint', siteId: moved.site.id, estimate: moveEstimate });
          telemetry.record({ department: actor.department, event: 'migrate', mbMoved: chain.keep.size_mb, estimate: moveEstimate });
          master = { ...moved.file, site_name: moved.site.display_name };
        }
        const recycled = chain.removable.map((f) => {
          const r = graph.moveToRecycleBin(actor, f.id);
          audit(actor, { file: f, action: 'recycle_duplicate', fromLocation: 'OneDrive', fromFolder: r.fromFolder,
            toLocation: 'Prullenbak', estimate: perCopy });
          telemetry.record({ department: actor.department, event: 'recycle_duplicate', storageFreedMb: f.size_mb, estimate: perCopy });
          return { id: f.id, filename: f.filename, folder: r.fromFolder };
        });
        return { master, recycled, moveEstimate };
      });

      const total = outcome.moveEstimate ? { ...removal, co2_g: addBands(removal.co2_g, outcome.moveEstimate.co2_g),
        kwh: addBands(removal.kwh, outcome.moveEstimate.kwh) } : removal;
      return {
        master: { filename: outcome.master.filename, location: 'SharePoint', site: outcome.master.site_name ?? null },
        recycled: outcome.recycled,
        estimate: presentEstimate(total, c),
        colleagues_with_copy: chain.colleagues,
        restore_hint: 'Kopieën staan in je prullenbak en zijn 93 dagen terug te zetten.',
      };
    },

    /** Undo: put a recycled copy back where it was. */
    restore(actor, { fileId }) {
      return inTransaction(db, () => {
        const file = graph.restoreFromRecycleBin(actor, fileId);
        const original = q.lastRecycleLog.get(actor.sub, fileId);
        const est = original
          ? { storage_freed_mb: original.storage_freed_mb, co2_g: { low: original.co2_low_g, high: original.co2_high_g },
            kwh: { low: original.kwh_low, high: original.kwh_high }, dc_kwh: { low: original.kwh_low, high: original.kwh_high } }
          : { storage_freed_mb: 0, co2_g: { low: 0, high: 0 }, kwh: { low: 0, high: 0 }, dc_kwh: { low: 0, high: 0 } };
        audit(actor, { file, action: 'restore', fromLocation: 'Prullenbak', fromFolder: original?.from_folder ?? '',
          toLocation: 'OneDrive', estimate: est });
        telemetry.record({ department: actor.department, event: 'restore', storageFreedMb: est.storage_freed_mb, estimate: est });
        return { file_id: file.id, filename: file.filename, status: file.status, size_mb: round(file.size_mb, 1) };
      });
    },
  };
}
