/**
 * @file moveBoard.js
 * @description Bestanden part "Verhuizen". One place per file, in this order:
 *
 *   1. "Klaar om te verhuizen"  the main list: shared documents that belong to the
 *                               team, each with a suggested folder ("Voorstel:
 *                               Wonen › Documenten › Beleid").
 *   2. "Eerst nakijken"         files not edited for more than a year: check the
 *                               retention rules before moving them.
 *   3. "Zelf slepen"            (collapsed) two file panels for people who want to
 *                               drag: the OTHER OneDrive files on the left, the
 *                               team sites with their folders on the right.
 *
 * A file appears in only one of these places. While you drag a file, its
 * suggested folder is highlighted on the right; a closed site/folder opens when
 * you hover over it. Keyboard users use "Verhuizen…", which opens the same
 * dialog with the suggested folder preselected (accessibility).
 *
 * TODO(teams): a real move from OneDrive to a SharePoint library is a move between
 * two drives; see "Open risks for the Teams version" in ARCHITECTURE.md.
 * HTML5 drag-and-drop works in Teams desktop and web, not on mobile; the button does.
 */

import { api } from './api.js';
import { el, append, button, fileIcon, icon, infoButton, toast } from './dom.js';
import { formatSize, lastEditedLabel, plural } from './format.js';
import { openMoveDialog, siteLabel, folderLabel } from './moveDialog.js';
import { renderExplorerWindow, folderNode } from './explorerWindow.js';

const $ = (id) => document.getElementById(id);

/** Data type used while dragging, so folders only accept our own file rows. */
const DRAG_TYPE = 'application/x-opruimcoach-file';

/** How long (ms) you hover over a closed site/folder with a file before it opens. */
const HOVER_OPEN_MS = 600;

/** Explanation behind the "i" next to the OneDrive panel (honest "last edited"). */
const LAST_EDITED_INFO = () => [
  el('p', 'info-title', 'Laatst bewerkt'),
  el('p', '', 'We tonen wanneer een bestand voor het laatst is gewijzigd. ' +
    'Wanneer iemand een bestand alleen heeft geopend, houdt Microsoft 365 niet voor elk bestand bij. Daarom zeggen we "bewerkt" en niet "geopend".'),
];

/** @param {object} ctx shared app context (see app.js) */
export function createMoveBoard(ctx) {
  const state = {
    ready: [],      // 1. shared, recently edited: ready to move
    check: [],      // 2. not edited for over a year: check the retention rules first
    others: [],     // 3. every other OneDrive file (only in "Zelf slepen")
    tree: [],       // team sites with their folders
    snoozedCount: 0,
  };
  /** The last move, so the destination folder can be opened and the file marked "Net verhuisd". */
  let lastMove = null;
  /** Folder id -> its <details> in the SharePoint panel (for highlighting the suggestion). */
  const folderElements = new Map();

  // --- Helpers -------------------------------------------------------------------------

  /** Finds a folder and its site in the SharePoint tree. */
  function findFolder(folderId) {
    for (const site of state.tree) {
      const folder = site.folders.find((f) => f.id === folderId);
      if (folder) return { site, folder };
    }
    return null;
  }

  /** "Voorstel: Wonen › Documenten › Beleid" for a file with a suggested folder. */
  function suggestionLine(file) {
    const found = file.suggested_folder ? findFolder(file.suggested_folder.id) : null;
    if (!found) return null;
    return append(el('div', 'ready-target'), icon('shortcut'), el('span', '', `Voorstel: ${folderLabel(found.site, found.folder)}`));
  }

  const allFiles = () => [...state.ready, ...state.check, ...state.others];
  const fileById = (id) => allFiles().find((f) => f.id === id);

  // --- Moving -----------------------------------------------------------------------

  /** Opens the dialog (suggested or dropped-on folder preselected), then moves the file. */
  async function move(file, { folderId } = {}) {
    const choice = await openMoveDialog({ file, tree: state.tree, folderId });
    if (!choice) return;
    try {
      const result = await api.migrate(file.id, choice.siteId, choice.folderId);
      lastMove = { siteId: result.site.id, folderId: result.folder.id, fileId: result.file.id };
      // One file: no CO2 here (tiny numbers say nothing); the totals are on the Actie-hub and Impact.
      toast(`${result.file.filename} staat nu in ${folderLabel(result.site, result.folder)}.`, { ms: 8000 });
      await ctx.refreshAll(); // every tab (and other open windows) shows the new situation
    } catch (err) {
      toast(err.message);
    }
  }

  /** "Nu niet": hidden from the ready list for a week; the file stays where it is. */
  async function snooze(file) {
    state.ready = state.ready.filter((f) => f.id !== file.id);
    renderReady();
    try {
      await api.snooze(file.id);
      state.snoozedCount += 1;
      toast(`Prima, ${file.filename} blijft in je OneDrive. We vragen het een week niet opnieuw.`);
    } catch {
      toast(`${file.filename} blijft in je OneDrive.`);
    }
    renderReady();
  }

  // --- Drag and drop -----------------------------------------------------------------

  /** While dragging, the suggested folder is highlighted (and its site opened). */
  function highlightSuggestion(file, on) {
    const details = file.suggested_folder ? folderElements.get(file.suggested_folder.id) : null;
    if (!details) return;
    details.classList.toggle('is-suggested', on);
    if (on) details.closest('details:not(.sp-folder)')?.setAttribute('open', '');
  }

  function makeDraggable(row, file) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(DRAG_TYPE, String(file.id));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
      $('self-drag').open = true; // the folders to drop on are in "Zelf slepen"
      document.body.classList.add('is-dragging-file'); // CSS shows every folder as a drop zone
      highlightSuggestion(file, true);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      document.body.classList.remove('is-dragging-file');
      highlightSuggestion(file, false);
    });
  }

  const isOurDrag = (e) => e.dataTransfer.types.includes(DRAG_TYPE);

  /** A closed <details> opens when a file hovers over it for a moment (like Windows). */
  function openOnHover(details) {
    let timer = null;
    details.addEventListener('dragover', (e) => {
      if (!isOurDrag(e) || details.open || timer) return;
      timer = setTimeout(() => { details.open = true; timer = null; }, HOVER_OPEN_MS);
    });
    details.addEventListener('dragleave', (e) => {
      if (details.contains(e.relatedTarget)) return;
      clearTimeout(timer);
      timer = null;
    });
  }

  /** A SharePoint folder accepts a dropped file (the whole folder: its row and contents). */
  function makeDropFolder(details, folder) {
    details.addEventListener('dragover', (e) => {
      if (!isOurDrag(e)) return;
      e.preventDefault(); // allows the drop
      e.dataTransfer.dropEffect = 'move';
      details.classList.add('is-drop-target');
    });
    details.addEventListener('dragleave', (e) => {
      if (!details.contains(e.relatedTarget)) details.classList.remove('is-drop-target');
    });
    details.addEventListener('drop', (e) => {
      details.classList.remove('is-drop-target');
      document.body.classList.remove('is-dragging-file');
      if (!isOurDrag(e)) return;
      e.preventDefault();
      const file = fileById(Number(e.dataTransfer.getData(DRAG_TYPE)));
      if (file) move(file, { folderId: folder.id });
    });
    openOnHover(details);
  }

  // --- 1. Klaar om te verhuizen -----------------------------------------------------------

  function readyRow(file) {
    const row = append(el('li', 'file-row ready-row'),
      fileIcon(file.filename),
      append(el('div', 'file-row-main'),
        el('div', 'file-row-name', file.filename),
        el('div', 'file-row-meta', `${lastEditedLabel(file.last_modified)} · ${formatSize(file.size_mb)} · map ${file.folder}`),
        el('div', 'ready-reason', file.reason),
        suggestionLine(file)),
      append(el('div', 'row-actions'),
        button('Verhuizen…', 'btn btn-primary btn-sm', () => move(file)),
        button('Nu niet', 'btn btn-secondary btn-sm', () => snooze(file))));
    makeDraggable(row, file);
    return row;
  }

  function renderReady() {
    const list = $('ready-list');
    list.replaceChildren(...state.ready.map(readyRow));
    if (state.ready.length === 0) list.append(el('li', 'empty', 'Er staan geen gedeelde documenten meer in je OneDrive die bij je team horen. Dank je wel!'));
    const note = $('snoozed-note');
    note.hidden = state.snoozedCount === 0;
    note.textContent = `${plural(state.snoozedCount, 'bestand', 'bestanden')} tijdelijk verborgen omdat je "Nu niet" koos.`;
  }

  // --- 2. Eerst nakijken (lang niet bewerkt) -----------------------------------------------

  function checkRow(file) {
    const row = append(el('li', 'file-row ready-row'),
      fileIcon(file.filename),
      append(el('div', 'file-row-main'),
        el('div', 'file-row-name', file.filename),
        el('div', 'file-row-meta', `${lastEditedLabel(file.last_modified)} · ${formatSize(file.size_mb)} · map ${file.folder}`),
        suggestionLine(file)),
      // Secondary on purpose: first check, then (maybe) move.
      append(el('div', 'row-actions'), button('Verhuizen…', 'btn btn-secondary btn-sm', () => move(file))));
    makeDraggable(row, file);
    return row;
  }

  function renderCheck() {
    $('check-panel').hidden = state.check.length === 0;
    $('check-list').replaceChildren(...state.check.map(checkRow));
  }

  // --- 3. Zelf slepen: left panel (the other OneDrive files) -------------------------------

  function oneDriveFileRow(file) {
    const tags = append(el('span', 'file-tags'),
      file.is_shared ? el('span', 'pill pill--muted', 'Gedeeld bestand') : null,
      file.has_identical_copy ? el('span', 'pill pill--muted', 'Heeft een kopie') : null);
    const row = append(el('div', 'tree-row is-file od-file'),
      fileIcon(file.filename),
      append(el('span', 'tree-file-main'),
        el('span', 'tree-name', file.filename),
        el('span', 'tree-file-meta', `${lastEditedLabel(file.last_modified)} · ${formatSize(file.size_mb)}`),
        tags.childElementCount ? tags : null),
      button('Verhuizen…', 'btn-link tree-action', () => move(file)));
    row.title = 'Sleep naar een map op de teamsite';
    makeDraggable(row, file);
    return append(el('li'), row);
  }

  function renderOneDrive() {
    // Group files by their OneDrive folder, like Explorer shows them.
    const folders = new Map();
    for (const file of state.others) {
      if (!folders.has(file.folder)) folders.set(file.folder, []);
      folders.get(file.folder).push(file);
    }
    const tree = el('ul', 'tree');
    tree.setAttribute('aria-label', 'Jouw OneDrive');
    for (const [name, files] of [...folders].sort(([a], [b]) => a.localeCompare(b, 'nl'))) {
      const node = folderNode({ name, count: files.length, open: true });
      node.list.append(...files.map(oneDriveFileRow));
      tree.append(node.li);
    }
    if (folders.size === 0) tree.append(el('li', 'tree-more', 'Geen andere bestanden in je OneDrive.'));
    renderExplorerWindow($('od-window'), 'OneDrive - Gemeente Amsterdam', tree);
  }

  // --- 3. Zelf slepen: right panel (team sites with folders) -------------------------------

  function renderSharePoint() {
    folderElements.clear();
    const tree = el('ul', 'tree');
    tree.setAttribute('aria-label', 'Je teamsites op SharePoint');
    state.tree.forEach((site, index) => {
      // Your own team's site (the first one) is open, and so is the site you just moved a file to.
      const siteNode = folderNode({ name: siteLabel(site), iconName: 'shortcut', open: index === 0 || site.id === lastMove?.siteId });
      siteNode.row.append(el('span', 'small muted', site.is_team_site ? 'teamsite' : 'programmasite'));
      openOnHover(siteNode.details);

      for (const folder of site.folders) {
        const isDestination = folder.id === lastMove?.folderId;
        const node = folderNode({ name: folder.name, count: folder.files.length + folder.more, extraClass: 'sp-folder', open: isDestination });
        node.row.append(el('span', 'suggest-hint', 'Voorstel'), el('span', 'drop-hint', 'Zet hier neer'));
        for (const f of folder.files) {
          const justMoved = isDestination && f.id === lastMove.fileId;
          node.list.append(append(el('li'), append(el('div', `tree-row is-file sp-file${justMoved ? ' is-just-moved' : ''}`),
            fileIcon(f.name), el('span', 'tree-name', f.name),
            justMoved ? el('span', 'pill pill--success', 'Net verhuisd') : null,
            el('span', 'tree-file-meta', lastEditedLabel(f.last_modified)))));
        }
        if (folder.more) node.list.append(el('li', 'tree-more', `… en ${folder.more} meer`));
        if (folder.files.length === 0) node.list.append(el('li', 'tree-more', 'leeg'));
        makeDropFolder(node.details, folder);
        folderElements.set(folder.id, node.details);
        siteNode.list.append(node.li);
      }
      tree.append(siteNode.li);
    });
    if (state.tree.length === 0) tree.append(el('li', 'tree-more', 'Geen teamsites gevonden.'));
    renderExplorerWindow($('sp-window'), 'SharePoint - Gemeente Amsterdam', tree, { addressIcon: 'shortcut' });
  }

  // One-time wiring: the "Laatst bewerkt" explanation (one per card).
  $('od-title').after(infoButton('Uitleg over "Laatst bewerkt"', LAST_EDITED_INFO));

  return {
    /** Jump from the Actie-hub: 'ready' -> the main list, 'old' -> "Eerst nakijken". */
    applyFilter(filter) {
      const target = filter === 'old' ? $('check-panel') : filter === 'ready' ? $('ready-panel') : null;
      if (target && !target.hidden) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },

    async load() {
      if (!ctx.me.admin_consent_granted) {
        Object.assign(state, { ready: [], check: [], others: [], tree: [] });
        renderSharePoint(); renderReady(); renderCheck(); renderOneDrive();
        return;
      }
      const [scan, oneDrive, sharePoint] = await Promise.all([api.scan(), api.oneDrive(), api.sharePointTree()]);
      state.tree = sharePoint.sites;
      state.snoozedCount = scan.snoozed_count;
      // Every file in exactly one place: ready (shared, recent) / check (old) / others.
      state.ready = scan.files.filter((f) => !f.is_old);
      state.check = oneDrive.files.filter((f) => f.is_old);
      const listed = new Set([...state.ready, ...state.check].map((f) => f.id));
      state.others = oneDrive.files.filter((f) => !listed.has(f.id));
      renderSharePoint(); // first: the suggestion lines look up folder names in the tree
      renderReady();
      renderCheck();
      renderOneDrive();
    },
  };
}
