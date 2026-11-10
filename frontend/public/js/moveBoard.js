/**
 * @file moveBoard.js
 * @description Bestanden part "Verhuizen": two windows that look like Windows
 * Explorer, side by side.
 *
 *   left   "Jouw OneDrive": your folders and files (draggable)
 *   right  "Je teamsites": every team site with the folders of its library
 *
 * The user drags a file onto the FOLDER where it belongs; the user chooses,
 * because documents belong in a specific folder. A closed site or folder opens
 * by itself when you hover over it with a file, as in Windows.
 * Keyboard and screen-reader users use the "Verhuizen…" button on every file,
 * which opens the same dialog with a folder choice (accessibility).
 *
 * Below the windows: "Klaar om te verhuizen", shared documents that probably
 * belong to the team, with a suggested team site and a one-line reason.
 *
 * TODO(teams): a real move from OneDrive to a SharePoint library is a move between
 * two drives; see "Open risks for the Teams version" in ARCHITECTURE.md.
 * HTML5 drag-and-drop works in Teams desktop and web, not on mobile; the button does.
 */

import { api } from './api.js';
import { el, append, button, fileIcon, icon, infoButton, toast } from './dom.js';
import { formatSize, lastEditedLabel, plural } from './format.js';
import { co2Amount, co2Text } from './co2.js';
import { openMoveDialog, siteLabel, folderLabel } from './moveDialog.js';
import { renderExplorerWindow, folderNode } from './explorerWindow.js';

const $ = (id) => document.getElementById(id);

/** Data type used while dragging, so folders only accept our own file rows. */
const DRAG_TYPE = 'application/x-opruimcoach-file';

/** How long (ms) you hover over a closed site/folder with a file before it opens. */
const HOVER_OPEN_MS = 600;

/** What each filter of the OneDrive window shows. */
const FILTERS = {
  all: { test: () => true, note: '' },
  shared: { test: (f) => f.is_shared, note: 'Gedeelde bestanden horen vaak bij je team, op de teamsite.' },
  old: {
    test: (f) => f.is_old,
    note: 'Deze bestanden zijn al meer dan een jaar niet bewerkt. Bekijk of je ze nog nodig hebt, en waar ze volgens de bewaarregels (Archiefwet) horen. Twijfel je? Vraag het je archiefadviseur.',
  },
};

/** Explanation behind the "i" next to the OneDrive window (honest "last edited"). */
const LAST_EDITED_INFO = () => [
  el('p', 'info-title', 'Laatst bewerkt'),
  el('p', '', 'We tonen wanneer een bestand voor het laatst is gewijzigd. ' +
    'Wanneer iemand een bestand alleen heeft geopend, houdt Microsoft 365 niet voor elk bestand bij. Daarom zeggen we "bewerkt" en niet "geopend".'),
];

/** @param {object} ctx shared app context (see app.js) */
export function createMoveBoard(ctx) {
  const state = { ready: [], snoozedCount: 0, oneDrive: [], tree: [], filter: 'all' };
  /** The last move, so the destination folder can be opened and the file marked "Net verhuisd". */
  let lastMove = null;

  // --- Moving -----------------------------------------------------------------------

  /** Asks for the folder (and confirmation) in the dialog, then moves the file. */
  async function move(file, { folderId } = {}) {
    const estimate = state.ready.find((f) => f.id === file.id)?.estimate;
    const choice = await openMoveDialog({ file, tree: state.tree, folderId, estimate });
    if (!choice) return;
    try {
      const result = await api.migrate(file.id, choice.siteId, choice.folderId);
      lastMove = { siteId: result.site.id, folderId: result.folder.id, fileId: result.file.id };
      const saving = result.estimate ? ` Geschatte besparing: ${co2Text(result.estimate.co2_per_year)}.` : '';
      toast(`${result.file.filename} staat nu in ${folderLabel(result.site, result.folder)}.${saving}`, { ms: 8000 });
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

  /** Finds a OneDrive file by id (from the window or the ready list). */
  const fileById = (id) => state.oneDrive.find((f) => f.id === id) ?? state.ready.find((f) => f.id === id);

  // --- Drag and drop -----------------------------------------------------------------

  function makeDraggable(row, file) {
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(DRAG_TYPE, String(file.id));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
      document.body.classList.add('is-dragging-file'); // CSS shows every folder as a drop zone
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      document.body.classList.remove('is-dragging-file');
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

  // --- Left window: OneDrive ---------------------------------------------------------

  /** One draggable file row with "Laatst bewerkt", tags and the keyboard alternative. */
  function oneDriveFileRow(file) {
    const tags = append(el('span', 'file-tags'),
      file.is_shared ? el('span', 'pill pill--muted', 'Gedeeld bestand') : null,
      file.is_old ? el('span', 'pill pill--warning', 'Lang niet bewerkt') : null,
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
    const filter = FILTERS[state.filter] ?? FILTERS.all;
    $('od-filter').value = state.filter;
    const note = $('od-filter-note');
    note.textContent = filter.note;
    note.hidden = !filter.note;

    // Group files by their OneDrive folder, like Explorer shows them.
    const folders = new Map();
    for (const file of state.oneDrive) {
      if (!folders.has(file.folder)) folders.set(file.folder, []);
      folders.get(file.folder).push(file);
    }

    const tree = el('ul', 'tree');
    tree.setAttribute('aria-label', 'Jouw OneDrive');
    for (const [name, files] of [...folders].sort(([a], [b]) => a.localeCompare(b, 'nl'))) {
      const visible = files.filter(filter.test);
      const node = folderNode({ name, count: visible.length, open: visible.length > 0 });
      node.list.append(...visible.map(oneDriveFileRow));
      if (visible.length === 0) node.list.append(el('li', 'tree-more', 'geen bestanden bij deze keuze'));
      tree.append(node.li);
    }
    if (folders.size === 0) tree.append(el('li', 'tree-more', 'Geen bestanden in je OneDrive.'));
    renderExplorerWindow($('od-window'), 'OneDrive - Gemeente Amsterdam', tree);
  }

  // --- Right window: team sites with folders -------------------------------------------

  function renderSharePoint() {
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
        node.row.append(el('span', 'drop-hint', 'Zet hier neer'));
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
        siteNode.list.append(node.li);
      }
      tree.append(siteNode.li);
    });
    if (state.tree.length === 0) tree.append(el('li', 'tree-more', 'Geen teamsites gevonden.'));
    renderExplorerWindow($('sp-window'), 'SharePoint - Gemeente Amsterdam', tree, { addressIcon: 'shortcut' });
  }

  // --- Below: ready to move ----------------------------------------------------------------

  function readyRow(file) {
    const row = append(el('li', 'file-row ready-row'),
      fileIcon(file.filename),
      append(el('div', 'file-row-main'),
        el('div', 'file-row-name', file.filename),
        el('div', 'file-row-meta', `${lastEditedLabel(file.last_modified)} · ${formatSize(file.size_mb)} · map ${file.folder}`),
        el('div', 'ready-reason', file.reason),
        append(el('div', 'ready-target'), icon('shortcut'),
          el('span', '', `Voorstel: teamsite ${siteLabel(file.suggested_site)} (jij kiest de map)`))),
      append(el('div', 'ready-side'),
        co2Amount(file.estimate.co2_per_year, { info: false, stacked: true }),
        append(el('div', 'row-actions'),
          button('Verhuizen…', 'btn btn-primary btn-sm', () => move(file)),
          button('Nu niet', 'btn btn-secondary btn-sm', () => snooze(file)))));
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

  // One-time wiring: filter dropdown and the "Laatst bewerkt" explanation.
  $('od-filter').addEventListener('change', (e) => { state.filter = e.target.value; renderOneDrive(); });
  $('od-title').after(infoButton('Uitleg over "Laatst bewerkt"', LAST_EDITED_INFO));

  return {
    /**
     * Jump to a filter from the Actie-hub: 'ready' scrolls to the ready list,
     * 'old' / 'shared' set the OneDrive filter and scroll to the windows.
     */
    applyFilter(filter) {
      if (filter && filter in FILTERS) state.filter = filter;
      if (state.oneDrive.length) renderOneDrive();
      const target = filter === 'ready' ? $('ready-panel') : filter ? $('board') : null;
      if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },

    async load() {
      if (!ctx.me.admin_consent_granted) {
        state.ready = []; state.oneDrive = []; state.tree = [];
        renderOneDrive(); renderSharePoint(); renderReady();
        return;
      }
      const [scan, oneDrive, sharePoint] = await Promise.all([api.scan(), api.oneDrive(), api.sharePointTree()]);
      state.ready = scan.files;
      state.snoozedCount = scan.snoozed_count;
      state.oneDrive = oneDrive.files;
      state.tree = sharePoint.sites;
      renderOneDrive();
      renderSharePoint();
      renderReady();
    },
  };
}
