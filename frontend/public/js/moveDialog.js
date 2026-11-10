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

/** The benefits of moving, in words that matter to an employee (shown before any CO2). */
export const MOVE_BENEFITS = ['Je team kan erbij', 'Bewaard volgens de bewaarregels'];

/** Small neutral labels, e.g. [Je team kan erbij] [Bewaard volgens de bewaarregels]. */
export function benefitTags(benefits) {
  return append(el('span', 'benefits'), ...benefits.map((b) => el('span', 'benefit', b)));
}

/** The blue explanation: what moving means, why, and where the file goes (by name). */
function explanation(choice) {
  const box = el('div', 'move-explainer');
  if (!choice) {
    append(box, el('strong', '', 'Verhuizen naar SharePoint: '), 'kies de map op de teamsite waar dit document hoort.');
    return box;
  }
  const { site, folder } = choice;
  return append(box,
    el('strong', '', 'Verhuizen naar SharePoint: '),
    `dit document hoort bij je team. Op de teamsite ${site.display_name} kunnen collega's erbij, ` +
    'en wordt het bewaard volgens de bewaarregels van de gemeente. ' +
    `In je OneDrive staat het daarna niet meer: je vindt het in ${folderLabel(site, folder)}.`);
}

/**
 * Fills the folder dropdown: one group per team site, one option per folder.
 * The suggested folder is marked "(voorstel)".
 */
function fillFolderSelect(select, tree, folderId, suggestedId) {
  const placeholder = new Option('Kies een map…', '', !folderId, !folderId);
  placeholder.disabled = true;
  const groups = tree.map((site) => {
    const group = document.createElement('optgroup');
    group.label = siteLabel(site);
    for (const folder of site.folders) {
      const label = folder.id === suggestedId ? `${folder.name} (voorstel)` : folder.name;
      group.append(new Option(label, String(folder.id), false, folder.id === folderId));
    }
    return group;
  });
  select.replaceChildren(placeholder, ...groups);
}

/**
 * Opens the dialog and waits for the user's choice.
 * @param {object} options
 * @param {{ filename: string, size_mb: number, last_modified: string }} options.file
 * @param {object[]} options.tree     team sites with their folders (GET /api/user/sharepoint-tree)
 * @param {number} [options.folderId] preselected folder: the folder the file was dropped
 *   on, or else the suggested folder (file.suggested_folder)
 * @returns {Promise<{ siteId: string, folderId: number } | null>} null when cancelled
 */
export function openMoveDialog({ file, tree, folderId }) {
  const suggestedId = file.suggested_folder?.id;
  const preselected = folderId ?? suggestedId;
  const dialog = $('move-dialog');
  const select = $('move-folder');
  const ok = $('move-ok');
  const cancel = $('move-cancel');

  $('move-file').replaceChildren(append(el('div', 'move-file-row'), fileIcon(file.filename),
    append(el('div'),
      el('div', 'file-row-name', file.filename),
      el('div', 'file-row-meta', `${lastEditedLabel(file.last_modified)} · ${formatSize(file.size_mb)}`))));

  fillFolderSelect(select, tree, preselected, suggestedId);
  $('move-benefits').replaceChildren(benefitTags(MOVE_BENEFITS));

  /** Keeps the explanation and the button in sync with the chosen folder. */
  const update = () => {
    const choice = select.value ? findFolder(tree, Number(select.value)) : null;
    $('move-explain').replaceChildren(explanation(choice));
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
