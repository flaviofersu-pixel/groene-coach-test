/**
 * @file userService.js
 * @description Profile, permissions and the "SharePoint Mapper".
 *
 * THE VISIBILITY PROBLEM: civil servants keep files in OneDrive because the
 * department SharePoint library is "hard to find". The mapper solves this with
 * OneDrive's standard "Add shortcut to My files": a SharePoint Shortcut Link
 * Object is inserted into the user's OneDrive root, so the department library
 * shows up in OneDrive and Windows Explorer via the standard sync client.
 * No desktop software, no Explorer modification.
 */

import { config, GRAPH_SCOPES } from '../config.js';
import { inTransaction } from '../db/database.js';
import { HttpError } from '../errors.js';

/** Max files listed per folder in the Explorer preview. */
const FILES_PER_FOLDER = 6;

/** Max files listed per folder in the Bestanden tab's SharePoint window. */
const TREE_FILES_PER_FOLDER = 25;

/**
 * @param {object} deps
 * @param {import('node:sqlite').DatabaseSync} deps.db
 * @param {ReturnType<import('../graph/graphMock.js').createGraphMock>} deps.graph
 * @param {ReturnType<import('./telemetry.js').createTelemetry>} deps.telemetry
 * @param {() => Date} deps.now
 */
export function createUserService({ db, graph, telemetry, now }) {
  const q = {
    user: db.prepare('SELECT id, display_name, email, department FROM users WHERE id = ?'),
    sites: db.prepare(`
      SELECT s.id, s.display_name, s.department, s.web_url, s.library_name, m.role,
             EXISTS (SELECT 1 FROM onedrive_items oi
                     WHERE oi.owner_id = m.user_id AND oi.target_site_id = s.id AND oi.item_type = 'shortcut') AS mapped
      FROM site_memberships m JOIN sharepoint_sites s ON s.id = m.site_id
      WHERE m.user_id = ?
      ORDER BY (s.department IS NULL), s.display_name`),
    departmentSite: db.prepare('SELECT id FROM sharepoint_sites WHERE department = ?'),
    rootItems: db.prepare(`SELECT * FROM onedrive_items WHERE owner_id = ? AND parent_id IS NULL
                           ORDER BY item_type DESC, name`), // shortcuts first, then folders
    odFiles: db.prepare(`SELECT id, filename, size_mb, times_shared, status, onedrive_folder_id
                         FROM files WHERE owner_id = ? AND current_location = 'OneDrive' ORDER BY filename`),
    movedByMe: db.prepare(`
      SELECT f.id, f.filename, f.size_mb, f.times_shared, l.from_folder, s.display_name AS site_name
      FROM migration_log l JOIN files f ON f.id = l.file_id
      LEFT JOIN sharepoint_sites s ON s.id = l.to_site_id
      WHERE l.user_id = ? AND l.action = 'migrate' AND f.current_location = 'SharePoint'
      GROUP BY f.id`),
    siteFolders: db.prepare('SELECT id, name FROM sharepoint_folders WHERE site_id = ? ORDER BY name'),
    siteById: db.prepare('SELECT id, display_name, library_name FROM sharepoint_sites WHERE id = ?'),
    folderFiles: db.prepare(`SELECT id, filename, size_mb, times_shared FROM files
                             WHERE sharepoint_folder_id = ? AND status = 'active' ORDER BY filename`),
    treeFiles: db.prepare(`SELECT id, filename, size_mb, last_modified FROM files
                           WHERE sharepoint_folder_id = ? AND status = 'active' ORDER BY filename`),
  };

  const fileNode = (f, tag) => ({ type: 'file', id: f.id, name: f.filename, size_mb: f.size_mb, shared: f.times_shared, ...(tag ? { tag } : {}) });

  /** Folders -> files of one site library, limited for readability. */
  function libraryChildren(siteId, movedIds) {
    return q.siteFolders.all(siteId).map((folder) => {
      const files = q.folderFiles.all(folder.id);
      return {
        type: 'folder',
        name: folder.name,
        children: files.slice(0, FILES_PER_FOLDER).map((f) => fileNode(f, movedIds.has(f.id) ? 'moved' : undefined)),
        more: Math.max(0, files.length - FILES_PER_FOLDER),
      };
    });
  }

  return {
    /** Profile + the delegated scopes in the token + site memberships. */
    me(actor) {
      const user = q.user.get(actor.sub);
      if (!user) throw new HttpError(404, 'Gebruiker niet gevonden.');
      const canRead = actor.scopes.includes(GRAPH_SCOPES.FILES_READ_ALL) || actor.scopes.includes(GRAPH_SCOPES.FILES_READWRITE_ALL);
      return {
        user,
        scopes: actor.scopes,
        admin_consent_granted: actor.scopes.includes(GRAPH_SCOPES.FILES_READWRITE_ALL),
        token_expires_at: new Date(actor.exp * 1000).toISOString(),
        sites: canRead ? q.sites.all(actor.sub).map((s) => ({ ...s, mapped: Boolean(s.mapped) })) : [],
      };
    },

    /**
     * POST /api/user/map-sharepoint-shortcut ("Snelkoppeling toevoegen aan Mijn bestanden").
     * Inserts the shortcut link object into the OneDrive root (idempotent).
     */
    mapSharePointShortcut(actor, { siteId }) {
      const target = siteId ?? q.departmentSite.get(actor.department)?.id;
      if (!target) throw new HttpError(409, 'Er is geen teamsite voor je team gevonden.');

      const result = inTransaction(db, () => {
        const r = graph.addSharePointShortcut(actor, target);
        if (r.created) telemetry.record({ department: actor.department, teamSiteId: target, event: 'shortcut_mapped' });
        return r;
      });
      return {
        created: result.created,
        shortcut: { id: result.shortcut.id, name: result.shortcut.name, created_at: result.shortcut.created_at },
        site: { id: result.site.id, display_name: result.site.display_name, web_url: result.site.web_url },
      };
    },

    /**
     * Folder tree of every team site the user is a member of, for the Bestanden tab's
     * right-hand window: site -> library folders -> files (names, sizes, dates only).
     * The user drags a OneDrive file onto the folder where it belongs.
     *
     * TODO(teams): GET /me/joinedTeams (Team.ReadBasic.All), then per team
     * GET /groups/{id}/drive/root/children and /drives/{drive-id}/items/{folder-id}/children
     * (Files.Read.All). These files are on sites the user can already open.
     */
    sharePointTree(actor) {
      graph.requireScope(actor, GRAPH_SCOPES.FILES_READ_ALL);
      const sites = q.sites.all(actor.sub).map((site) => ({
        id: site.id,
        display_name: site.display_name,
        library_name: site.library_name,
        is_team_site: site.department !== null,
        role: site.role,
        folders: q.siteFolders.all(site.id).map((folder) => {
          const files = q.treeFiles.all(folder.id);
          return {
            id: folder.id,
            name: folder.name,
            files: files.slice(0, TREE_FILES_PER_FOLDER).map((f) => ({ id: f.id, name: f.filename, size_mb: f.size_mb, last_modified: f.last_modified })),
            more: Math.max(0, files.length - TREE_FILES_PER_FOLDER),
          };
        }),
      }));
      return { sites };
    },

    /**
     * Two Explorer trees for the "before / after" preview:
     *  before = OneDrive as it was: files the coach helped move or clean up are
     *           back in their original folders, no shortcuts.
     *  after  = OneDrive now: lean folders + SharePoint shortcuts that open the
     *           department library with one click.
     */
    explorerView(actor) {
      graph.requireScope(actor, GRAPH_SCOPES.FILES_READ_ALL);
      const at = now().getTime();
      const items = q.rootItems.all(actor.sub);
      const folders = items.filter((i) => i.item_type === 'folder');
      const shortcuts = items.filter((i) => i.item_type === 'shortcut');
      const odFiles = q.odFiles.all(actor.sub);
      const moved = q.movedByMe.all(actor.sub);
      const movedIds = new Set(moved.map((m) => m.id));

      const before = folders.map((folder) => ({
        type: 'folder',
        name: folder.name,
        children: [
          ...odFiles.filter((f) => f.onedrive_folder_id === folder.id)
            .map((f) => fileNode(f, f.status === 'recycled' ? 'duplicate' : undefined)),
          ...moved.filter((m) => m.from_folder === folder.name)
            .map((m) => ({ ...fileNode(m, 'to-move'), site_name: m.site_name })),
        ].sort((a, b) => a.name.localeCompare(b.name, 'nl')),
      }));

      // "Na" always shows your own team's folder. Not added yet? Then it is shown as a
      // proposal ("Voorstel"), so the title "met je teammap erbij" is always true.
      const teamSiteId = q.departmentSite.get(actor.department)?.id;
      const teamSite = teamSiteId ? q.siteById.get(teamSiteId) : null;
      const proposal = teamSite && !shortcuts.some((s) => s.target_site_id === teamSite.id)
        ? [{
          type: 'shortcut',
          name: `${teamSite.display_name} - ${teamSite.library_name}`,
          site_id: teamSite.id,
          is_proposal: true,
          children: libraryChildren(teamSite.id, movedIds),
        }]
        : [];

      const after = [
        ...proposal,
        ...shortcuts.map((s) => ({
          type: 'shortcut',
          name: s.name,
          site_id: s.target_site_id,
          is_new: at - Date.parse(s.created_at) < 86_400_000,
          children: libraryChildren(s.target_site_id, movedIds),
        })),
        ...folders.map((folder) => ({
          type: 'folder',
          name: folder.name,
          children: odFiles.filter((f) => f.onedrive_folder_id === folder.id && f.status === 'active').map((f) => fileNode(f)),
        })),
      ];

      const countFiles = (nodes) => nodes.reduce((n, node) => n + (node.type === 'folder' ? node.children.length : 0), 0);
      return {
        root_name: 'OneDrive - Gemeente Amsterdam',
        shortcuts_mapped: shortcuts.length,
        before: { items: before, personal_file_count: countFiles(before) },
        after: { items: after, personal_file_count: countFiles(after.filter((n) => n.type === 'folder')) },
        share_threshold: config.shareThreshold,
      };
    },
  };
}
