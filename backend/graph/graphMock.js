/**
 * @file graphMock.js
 * @description The Microsoft Graph permission boundary, simulated.
 *
 * DESIGN PATTERN: Gateway / Anti-Corruption Layer. Services never mutate the
 * drive tables themselves; they call this gateway, exactly like production
 * code would call Microsoft Graph. Every method:
 *   1. names the real Graph endpoint it stands in for, and
 *   2. checks that the caller's token carries the required delegated scope
 *      (403 otherwise), exactly as Graph would reject the call.
 *
 * Swapping this module for a real Graph client (with the OBO token) is the
 * only change needed to go from simulation to production.
 *
 * There is deliberately NO method that hard-deletes a drive item.
 */

import { GRAPH_SCOPES } from '../config.js';
import { HttpError } from '../errors.js';
import { MOVED_FOLDER } from '../db/seedData.js';

/**
 * Throws 403 when the token lacks the scope. `Files.ReadWrite.All` implies
 * `Files.Read.All`, as in Microsoft Graph.
 * @param {{ scopes: string[] }} actor
 * @param {string} scope
 */
export function requireScope(actor, scope) {
  const has = actor.scopes.includes(scope) ||
    (scope === GRAPH_SCOPES.FILES_READ_ALL && actor.scopes.includes(GRAPH_SCOPES.FILES_READWRITE_ALL));
  if (!has) {
    throw new HttpError(403,
      `Ontbrekende Graph-toestemming '${scope}'. Een beheerder moet admin consent geven voor OpruimCoach.`);
  }
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ now?: () => Date }} [options]
 */
export function createGraphMock(db, { now = () => new Date() } = {}) {
  const q = {
    driveFiles: db.prepare(`
      SELECT f.*, oi.name AS folder_name
      FROM files f JOIN onedrive_items oi ON oi.id = f.onedrive_folder_id
      WHERE f.owner_id = ? AND f.current_location = 'OneDrive'`),
    myFiles: db.prepare(`SELECT id, filename, current_location, size_mb, times_shared FROM files
                         WHERE owner_id = ? AND status = 'active' ORDER BY filename`),
    fileById: db.prepare('SELECT * FROM files WHERE id = ?'),
    folderName: db.prepare('SELECT name FROM onedrive_items WHERE id = ?'),
    ensureSpFolder: db.prepare('INSERT OR IGNORE INTO sharepoint_folders (site_id, name) VALUES (?, ?)'),
    spFolderId: db.prepare('SELECT id FROM sharepoint_folders WHERE site_id = ? AND name = ?'),
    spFolderById: db.prepare('SELECT id, site_id, name FROM sharepoint_folders WHERE id = ?'),
    move: db.prepare(`
      UPDATE files SET current_location = 'SharePoint', onedrive_folder_id = NULL,
                       sharepoint_folder_id = :spFolder, department = :department
      WHERE id = :id AND current_location = 'OneDrive' AND status = 'active'`),
    recycle: db.prepare(`UPDATE files SET status = 'recycled', recycled_at = :now
                         WHERE id = :id AND status = 'active' AND current_location = 'OneDrive'`),
    restore: db.prepare(`UPDATE files SET status = 'active', recycled_at = NULL WHERE id = :id AND status = 'recycled'`),
    membership: db.prepare('SELECT role FROM site_memberships WHERE user_id = ? AND site_id = ?'),
    site: db.prepare('SELECT * FROM sharepoint_sites WHERE id = ?'),
    shortcut: db.prepare(`SELECT * FROM onedrive_items WHERE owner_id = ? AND target_site_id = ? AND item_type = 'shortcut'`),
    insertShortcut: db.prepare(`INSERT INTO onedrive_items (owner_id, parent_id, name, item_type, target_site_id, created_at)
                                VALUES (?, NULL, ?, 'shortcut', ?, ?)`),
  };

  /** Owner check: a delegated token can only act on the user's own OneDrive. */
  function ownFile(actor, fileId) {
    const file = q.fileById.get(fileId);
    if (!file) throw new HttpError(404, `Bestand ${fileId} bestaat niet.`);
    if (file.owner_id !== actor.sub) throw new HttpError(403, 'Je kunt alleen bestanden uit je eigen OneDrive beheren.');
    return file;
  }

  /** Site check: the user must be a member of the target site. */
  function memberSite(actor, siteId) {
    const site = q.site.get(siteId);
    if (!site) throw new HttpError(404, `SharePoint-site ${siteId} bestaat niet.`);
    if (!q.membership.get(actor.sub, siteId)) throw new HttpError(403, 'Je bent geen lid van deze SharePoint-site.');
    return site;
  }

  /**
   * The folder a file is moved into. The chosen folder must belong to the chosen
   * site (otherwise someone could move a file into a site they are not a member of).
   */
  function targetFolder(site, folderId) {
    if (folderId === undefined) {
      q.ensureSpFolder.run(site.id, MOVED_FOLDER);
      return { id: q.spFolderId.get(site.id, MOVED_FOLDER).id, name: MOVED_FOLDER };
    }
    const folder = q.spFolderById.get(folderId);
    if (!folder || folder.site_id !== site.id) throw new HttpError(404, 'Deze map bestaat niet op de gekozen teamsite.');
    return folder;
  }

  return {
    requireScope,

    /** GET /me/drive/root/children?$expand=permissions  (Files.Read.All) */
    listMyOneDriveFiles(actor) {
      requireScope(actor, GRAPH_SCOPES.FILES_READ_ALL);
      return q.driveFiles.all(actor.sub);
    },

    /** GET /me/drive/search + /me/followedSites drives: all own active files (Files.Read.All) */
    listMyFiles(actor) {
      requireScope(actor, GRAPH_SCOPES.FILES_READ_ALL);
      return q.myFiles.all(actor.sub);
    },

    /** GET /me/drive/items/{id}  (Files.Read.All) */
    getMyFile(actor, fileId) {
      requireScope(actor, GRAPH_SCOPES.FILES_READ_ALL);
      return ownFile(actor, fileId);
    },

    /**
     * PATCH /me/drive/items/{id}  body { parentReference: { driveId: <site library>, id: <folder> } }
     * (Files.ReadWrite.All — writes to two drives: personal OneDrive and site library)
     * TODO(teams): a move between two drives may not be supported by PATCH; see
     * "Open risks for the Teams version" in ARCHITECTURE.md.
     * @param {number} [folderId] folder chosen by the user; without it the coach's own
     *   "Verhuisd vanuit OneDrive" folder is used (e.g. for duplicate clean-up)
     * @returns {{ file: object, site: object, folder: { id: number, name: string }, fromFolder: string }}
     */
    moveToSharePoint(actor, fileId, siteId, folderId) {
      requireScope(actor, GRAPH_SCOPES.FILES_READWRITE_ALL);
      const file = ownFile(actor, fileId);
      if (file.status !== 'active') throw new HttpError(409, 'Dit bestand staat in de prullenbak.');
      if (file.current_location !== 'OneDrive') throw new HttpError(409, 'Dit bestand staat al op SharePoint.');
      const site = memberSite(actor, siteId);

      const fromFolder = q.folderName.get(file.onedrive_folder_id).name;
      const folder = targetFolder(site, folderId);
      const { changes } = q.move.run({ id: file.id, spFolder: folder.id, department: site.department ?? file.department });
      if (changes !== 1) throw new HttpError(409, 'Dit bestand is al verplaatst.'); // concurrent request
      return { file: q.fileById.get(file.id), site, folder: { id: folder.id, name: folder.name }, fromFolder };
    },

    /**
     * DELETE /me/drive/items/{id}  -> moves the item to the RECYCLE BIN (restorable
     * for 93 days in M365). Only ever called after explicit user confirmation,
     * and only for bit-identical copies. (Files.ReadWrite.All)
     */
    moveToRecycleBin(actor, fileId) {
      requireScope(actor, GRAPH_SCOPES.FILES_READWRITE_ALL);
      const file = ownFile(actor, fileId);
      const { changes } = q.recycle.run({ id: file.id, now: now().toISOString() });
      if (changes !== 1) throw new HttpError(409, 'Dit bestand kan niet naar de prullenbak.');
      return { file: q.fileById.get(file.id), fromFolder: q.folderName.get(file.onedrive_folder_id).name };
    },

    /** POST /me/drive/items/{id}/restore  (Files.ReadWrite.All) */
    restoreFromRecycleBin(actor, fileId) {
      requireScope(actor, GRAPH_SCOPES.FILES_READWRITE_ALL);
      const file = ownFile(actor, fileId);
      const { changes } = q.restore.run({ id: file.id });
      if (changes !== 1) throw new HttpError(409, 'Dit bestand staat niet in de prullenbak.');
      return q.fileById.get(file.id);
    },

    /**
     * POST /me/drive/root/children
     *   body { name: "<Site> - Documenten", remoteItem: { driveId, id }, "@microsoft.graph.conflictBehavior": "rename" }
     * This is OneDrive's standard "Add shortcut to My files": the library then
     * appears inside the user's OneDrive (and Windows Explorer via the standard
     * OneDrive client). Nothing is installed on the laptop. (Files.ReadWrite.All)
     * Idempotent: returns the existing shortcut if present.
     */
    addSharePointShortcut(actor, siteId) {
      requireScope(actor, GRAPH_SCOPES.FILES_READWRITE_ALL);
      const site = memberSite(actor, siteId);
      const existing = q.shortcut.get(actor.sub, site.id);
      if (existing) return { shortcut: existing, site, created: false };
      const name = `${site.display_name} - ${site.library_name}`;
      const { lastInsertRowid } = q.insertShortcut.run(actor.sub, name, site.id, now().toISOString());
      return { shortcut: q.shortcut.get(actor.sub, site.id), site, created: true, id: Number(lastInsertRowid) };
    },
  };
}
