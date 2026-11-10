/**
 * @file actionHubService.js
 * @description Business logic behind the Teams "Actie-hub".
 *
 *  - scanOneDrive          "Klaar om te verhuizen": shared OneDrive files + suggested team site + reason
 *  - listOneDrive          all own OneDrive files (left column of the Bestanden tab)
 *  - actionSummary         the action list of the Actie-hub (counts + estimated savings)
 *  - duplicateChains       identical copies (same content hash) in the user's OWN OneDrive
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
import { estimateMigration, estimateDuplicateRemoval, addBands, band } from './co2Calculator.js';
import { presentEstimate, round } from './present.js';
import { suggestFolder } from './folderSuggestion.js';

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
    siteById: db.prepare('SELECT id, display_name, library_name FROM sharepoint_sites WHERE id = ?'),
    siteFolders: db.prepare('SELECT id, name FROM sharepoint_folders WHERE site_id = ? ORDER BY name'),
    memberSiteIds: db.prepare('SELECT site_id FROM site_memberships WHERE user_id = ?'),
    unmappedSites: db.prepare(`
      SELECT COUNT(*) AS n FROM site_memberships m
      WHERE m.user_id = ? AND NOT EXISTS (SELECT 1 FROM onedrive_items oi
        WHERE oi.owner_id = m.user_id AND oi.target_site_id = m.site_id AND oi.item_type = 'shortcut')`),
    // A duplicate group = the same content hash at least twice in MY OneDrive, or once in
    // my OneDrive plus once on a team site I am a member of. Colleagues' OneDrives are
    // never looked at: a delegated Teams app cannot see them (and should not).
    chainHashes: db.prepare(`
      SELECT f.content_hash FROM files f
      WHERE f.owner_id = :me AND f.current_location = 'OneDrive' AND f.status = 'active'
      GROUP BY f.content_hash
      HAVING COUNT(*) >= 2 OR EXISTS (
        SELECT 1 FROM files sp
        JOIN sharepoint_folders spf ON spf.id = sp.sharepoint_folder_id
        JOIN site_memberships m     ON m.site_id = spf.site_id AND m.user_id = :me
        WHERE sp.content_hash = f.content_hash AND sp.status = 'active')`),
    chainFiles: db.prepare(`
      SELECT f.*, oi.name AS od_folder, sf.name AS sp_folder, sf.site_id AS site_id, s.display_name AS site_name
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
    if (!row) throw new HttpError(409, 'Er is geen teamsite voor je team gevonden.');
    return row.id;
  }

  /**
   * Suggested destination for a shared OneDrive file: the team site of the user's
   * own team (here: the department site).
   * TODO(teams): use the teams from GET /me/joinedTeams (Team.ReadBasic.All) and let the
   * user pick. Guessing the team from WHO the file is shared with would need group
   * member lists (GroupMember.Read.All) and feels like tracking, so we don't.
   */
  function suggestedSite(actor) {
    const site = q.siteById.get(defaultSiteId(actor));
    return { id: site.id, display_name: site.display_name, library_name: site.library_name };
  }

  /**
   * Suggested destination (site + folder) for one file, from the demo folder rules.
   * @returns {{ site: object, folder: { id: number, name: string, matched: boolean } | null }}
   */
  function suggestedDestination(site, filename) {
    return { site, folder: suggestFolder(filename, q.siteFolders.all(site.id)) };
  }

  /** One plain-Dutch line explaining why this file belongs on the team site. */
  function moveReason(activity) {
    return activity === 'active'
      ? 'Gedeeld en recent bewerkt: je team werkt hier nu samen aan.'
      : 'Gedeeld teamdocument: op de teamsite blijft het vindbaar voor je team.';
  }

  /** Shapes a file plus its migration estimate for the client. */
  function candidateDto(file, at, actor) {
    const est = estimateMigration(file, c, at);
    const destination = suggestedDestination(suggestedSite(actor), file.filename);
    return {
      id: file.id,
      filename: file.filename,
      current_location: file.current_location,
      size_mb: file.size_mb,
      times_shared: file.times_shared,
      last_modified: file.last_modified,
      folder: file.folder_name,
      activity: est.activity,
      suggested_site: destination.site,
      suggested_folder: destination.folder,
      // Not edited for a long time: first check the retention rules before moving.
      is_old: daysSince(file.last_modified, at) > config.oldFileDays,
      reason: moveReason(est.activity),
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

  /**
   * Analyses one duplicate group from the perspective of `actor`.
   * Only copies the user can see count: their own OneDrive copies and copies on
   * team sites they are a member of.
   *
   * DETECTION: equal content hash (Graph `file.hashes.quickXorHash`, needs `file` in
   * $select). The hash is metadata computed by Microsoft 365, so the contents are
   * never read. Same name + size would miss renamed copies ("Kopie van ...") and
   * would flag different files that happen to match.
   */
  function analyseChain(actor, hash) {
    const memberSites = new Set(q.memberSiteIds.all(actor.sub).map((r) => r.site_id));
    const copies = q.chainFiles.all(hash).filter((f) =>
      (f.owner_id === actor.sub && f.current_location === 'OneDrive') ||
      (f.current_location === 'SharePoint' && memberSites.has(f.site_id)));
    const master = copies.find((f) => f.current_location === 'SharePoint') ?? null;
    const mine = copies.filter((f) => f.current_location === 'OneDrive');
    // Without a SharePoint master, the user's newest copy becomes the master.
    const keep = master ? null : mine[0] ?? null;
    const removable = mine.filter((f) => f !== keep);
    const size = (copies[0] ?? { size_mb: 0 }).size_mb;

    return {
      copies, master, keep, removable, size,
      dto: {
        content_hash: hash,
        match: 'hash', // how the copies were recognised (see above)
        filename: (master ?? mine[0] ?? copies[0])?.filename ?? '',
        size_mb: size,
        my_copies: mine.map((f) => ({ id: f.id, filename: f.filename, folder: f.od_folder, last_modified: f.last_modified })),
        master: master
          ? { location: 'SharePoint', site: master.site_name, folder: master.sp_folder, filename: master.filename }
          : null,
        removable_count: removable.length,
        can_consolidate: removable.length > 0,
        my_saving: presentEstimate(estimateDuplicateRemoval(size, removable.length, c).total, c),
      },
    };
  }

  /**
   * Shared OneDrive files that belong on a team site, minus the ones the user
   * snoozed ("Nu niet"). Returns the raw files; callers shape them.
   * TODO(teams): the threshold counts sharing permissions (GET /items/{id}/permissions).
   * The neutral alternative is the yes/no `shared` facet on the driveItem.
   */
  function moveCandidates(actor, at) {
    // Expired snoozes are ignored here and purged by the retention job (server.js).
    const snoozed = new Set(q.snoozed.all(actor.sub, at.toISOString()).map((r) => r.file_id));
    const shared = graph.listMyOneDriveFiles(actor)
      .filter((f) => f.status === 'active' && f.times_shared > config.shareThreshold);
    return { shared, open: shared.filter((f) => !snoozed.has(f.id)) };
  }

  /** Sums the yearly estimates of several actions into one band. */
  function sumEstimates(totals) {
    return {
      co2_g: addBands(band(0), ...totals.map((t) => t.co2_g)),
      kwh: addBands(band(0), ...totals.map((t) => t.kwh)),
    };
  }

  /** Days since an ISO date. */
  const daysSince = (iso, at) => (at.getTime() - Date.parse(iso)) / DAY_MS;

  return {
    /** "Klaar om te verhuizen": shared OneDrive files with a suggested team site and a reason. */
    scanOneDrive(actor) {
      const at = now();
      const { shared, open } = moveCandidates(actor, at);
      const files = open
        .map((f) => candidateDto(f, at, actor))
        .sort((a, b) => b._sortKey - a._sortKey)
        .map(({ _sortKey, ...dto }) => dto);

      return {
        threshold: config.shareThreshold,
        count: files.length,
        snoozed_count: shared.length - files.length,
        files,
      };
    },

    /**
     * Left column of the Bestanden tab: ALL own OneDrive files (metadata only).
     * GET /me/drive/root/delta?$select=id,name,size,lastModifiedDateTime,parentReference,shared,file
     *
     * Only `lastModifiedDateTime` is reliable for every file. A real "last opened" date
     * is not: `fileSystemInfo.lastAccessedDateTime` is mostly empty for cloud files and
     * /me/insights/used only covers recently used documents. So the UI says
     * "Laatst bewerkt", never "Laatst geopend".
     */
    listOneDrive(actor) {
      const at = now();
      const files = graph.listMyOneDriveFiles(actor).filter((f) => f.status === 'active');
      const hashCount = new Map();
      for (const f of files) hashCount.set(f.content_hash, (hashCount.get(f.content_hash) ?? 0) + 1);
      const site = suggestedSite(actor);

      return {
        old_file_days: config.oldFileDays,
        files: files
          .map((f) => ({
            id: f.id,
            filename: f.filename,
            folder: f.folder_name,
            size_mb: f.size_mb,
            last_modified: f.last_modified,
            is_shared: f.times_shared > 0, // yes/no only: we never show how many people
            is_move_candidate: f.times_shared > config.shareThreshold,
            is_old: daysSince(f.last_modified, at) > config.oldFileDays,
            has_identical_copy: hashCount.get(f.content_hash) > 1,
            suggested_folder: suggestedDestination(site, f.filename).folder,
          }))
          .sort((a, b) => a.filename.localeCompare(b.filename, 'nl')),
      };
    },

    /**
     * The Actie-hub: a short list of concrete actions, each with a count and (where we
     * can estimate it honestly) the yearly saving. The UI turns this into titles + buttons.
     */
    actionSummary(actor) {
      const at = now();
      // Old files are not "ready to move": they are checked first (retention rules).
      const open = moveCandidates(actor, at).open.filter((f) => daysSince(f.last_modified, at) <= config.oldFileDays);
      const moveTotal = sumEstimates(open.map((f) => estimateMigration(f, c, at).total));

      const chains = q.chainHashes.all({ me: actor.sub }).map((r) => analyseChain(actor, r.content_hash));
      const removableCopies = chains.reduce((n, ch) => n + ch.removable.length, 0);
      const freedMb = chains.reduce((mb, ch) => mb + ch.size * ch.removable.length, 0);
      const duplicateTotal = sumEstimates(chains.map((ch) => estimateDuplicateRemoval(ch.size, ch.removable.length, c).total));

      const oldFiles = graph.listMyOneDriveFiles(actor)
        .filter((f) => f.status === 'active' && daysSince(f.last_modified, at) > config.oldFileDays);

      return {
        actions: [
          { id: 'move', count: open.length, estimate: open.length ? presentEstimate(moveTotal, c) : null },
          { id: 'duplicates', count: removableCopies, storage_freed_mb: round(freedMb, 1),
            estimate: removableCopies ? presentEstimate(duplicateTotal, c) : null },
          // No CO2 figure: what happens with old files depends on the retention rules.
          { id: 'old', count: oldFiles.length, old_file_days: config.oldFileDays, estimate: null },
          // No direct saving: a shortcut only makes the team files easier to find.
          { id: 'shortcut', count: q.unmappedSites.get(actor.sub).n, estimate: null },
        ],
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
      const chains = q.chainHashes.all({ me: actor.sub }).map((r) => analyseChain(actor, r.content_hash).dto);
      chains.sort((a, b) => b.size_mb * b.removable_count - a.size_mb * a.removable_count);
      return { count: chains.length, chains };
    },

    /** "Ja, verhuis het": OneDrive -> department SharePoint site. */
    migrateToSharePoint(actor, { fileId, siteId, folderId }) {
      const target = siteId ?? defaultSiteId(actor);
      const before = graph.getMyFile(actor, fileId);
      const est = estimateMigration(before, c, now());

      const result = inTransaction(db, () => {
        const moved = graph.moveToSharePoint(actor, fileId, target, folderId);
        audit(actor, {
          file: moved.file, action: 'migrate', fromLocation: 'OneDrive', fromFolder: moved.fromFolder,
          toLocation: 'SharePoint', siteId: moved.site.id, estimate: est.total,
        });
        q.clearSnooze.run(actor.sub, fileId);
        // The saving counts for the team the document moved TO.
        telemetry.record({ department: actor.department, teamSiteId: moved.site.id, event: 'migrate', mbMoved: before.size_mb, estimate: est.total });
        return moved;
      });

      return {
        file: { id: result.file.id, filename: result.file.filename, current_location: result.file.current_location },
        site: { id: result.site.id, display_name: result.site.display_name, library_name: result.site.library_name, web_url: result.site.web_url },
        folder: result.folder,
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
      if (!chain.copies.some((f) => f.owner_id === actor.sub && f.current_location === 'OneDrive')) {
        throw new HttpError(404, 'Deze reeks kopieën is niet gevonden.');
      }
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
          telemetry.record({ department: actor.department, teamSiteId: moved.site.id, event: 'migrate', mbMoved: chain.keep.size_mb, estimate: moveEstimate });
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
