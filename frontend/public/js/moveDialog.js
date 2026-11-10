/**
 * @file moveDialog.js
 * @description The "Verhuizen naar SharePoint" dialog.
 *
 * Used by every way of moving a file (dropping it on a folder, the "Verhuizen…"
 * button, the ready list), so the explanation is always the same:
 *   what moving means, why, and WHERE the file goes (site + folder, by name).
 * The user always chooses the folder: documents belong in a specific folder,
 * and the user knows best which one. Moving never says a file "weg mag": it goes
 * to the team site and is kept there according to the retention rules.
 */

import { el, append, fileIcon } from './dom.js';
import { formatSize, lastEditedLabel } from './format.js';
import { co2Amount } from './co2.js';

const $ = (id) => document.getElementById(id);

/** "Wonen › Documenten" */
export const siteLabel = (site) => `${site.display_name} › ${site.library_name}`;

/** "Wonen › Documenten › Beleid" */
export const folderLabel = (site, folder) => `${siteLabel(site)} › ${folder.name}`;

/** Finds a folder (and its site) in the SharePoint tree by folder id. */
function findFolder(tree, folderId) {
  for (const site of tree) {
    const folder = site.folders.find((f) => f.id === folderId);
    if (folder) return { site, folder };
  }
  return null;
}

/** The plain-Dutch explanation for the chosen destination. */
function explanation(choice) {
  if (!choice) return 'Kies de map op de teamsite waar dit document hoort.';
  const { site, folder } = choice;
  return `Dit document hoort bij je team. Op de teamsite ${site.display_name} kunnen collega's erbij, ` +
    'en wordt het bewaard volgens de bewaarregels van de gemeente. ' +
    `In je OneDrive staat het daarna niet meer: je vindt het in ${folderLabel(site, folder)}.`;
}

/** Fills the folder dropdown: one group per team site, one option per folder. */
function fillFolderSelect(select, tree, folderId) {
  const placeholder = new Option('Kies een map…', '', !folderId, !folderId);
  placeholder.disabled = true;
  const groups = tree.map((site) => {
    const group = document.createElement('optgroup');
    group.label = siteLabel(site);
    for (const folder of site.folders) group.append(new Option(folder.name, String(folder.id), false, folder.id === folderId));
    return group;
  });
  select.replaceChildren(placeholder, ...groups);
}

/**
 * Opens the dialog and waits for the user's choice.
 * @param {object} options
 * @param {{ filename: string, size_mb: number, last_modified: string }} options.file
 * @param {object[]} options.tree     team sites with their folders (GET /api/user/sharepoint-tree)
 * @param {number} [options.folderId] preselected folder (the folder the file was dropped on)
 * @param {object} [options.estimate] estimate from the API, when known
 * @returns {Promise<{ siteId: string, folderId: number } | null>} null when cancelled
 */
export function openMoveDialog({ file, tree, folderId, estimate }) {
  const dialog = $('move-dialog');
  const select = $('move-folder');
  const ok = $('move-ok');
  const cancel = $('move-cancel');

  $('move-file').replaceChildren(append(el('div', 'move-file-row'), fileIcon(file.filename),
    append(el('div'),
      el('div', 'file-row-name', file.filename),
      el('div', 'file-row-meta', `${lastEditedLabel(file.last_modified)} · ${formatSize(file.size_mb)}`))));

  fillFolderSelect(select, tree, folderId);

  const estimateLine = $('move-estimate');
  estimateLine.replaceChildren();
  if (estimate) estimateLine.append('Geschatte besparing: ', co2Amount(estimate.co2_per_year));
  estimateLine.hidden = !estimate;

  /** Keeps the explanation and the button in sync with the chosen folder. */
  const update = () => {
    const choice = select.value ? findFolder(tree, Number(select.value)) : null;
    $('move-explain').textContent = explanation(choice);
    ok.disabled = !choice;
    ok.textContent = choice ? `Verhuis naar ${choice.folder.name}` : 'Verhuizen';
  };
  update();

  return new Promise((resolve) => {
    const finish = (result) => {
      select.removeEventListener('change', update);
      ok.onclick = null;
      cancel.onclick = null;
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(result);
    };
    select.addEventListener('change', update);
    ok.onclick = () => {
      const choice = findFolder(tree, Number(select.value));
      finish(choice ? { siteId: choice.site.id, folderId: choice.folder.id } : null);
    };
    cancel.onclick = () => finish(null);
    dialog.onclose = () => finish(null); // Esc key
    dialog.showModal();
  });
}
