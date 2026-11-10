/**
 * @file preview.js
 * @description Bestanden part "Voor en na": how the user's OneDrive looks in
 * Windows Explorer (via the standard OneDrive sync client) before and after the
 * coach. Moved files are labelled with their destination team site BY NAME.
 * The preview is drawn in the browser; nothing on the laptop is modified.
 */

import { api } from './api.js';
import { el, append, icon, fileIcon } from './dom.js';
import { formatSize, plural } from './format.js';
import { renderExplorerWindow } from './explorerWindow.js';

const $ = (id) => document.getElementById(id);

/** Label (pill) per tag. `to-move` names the destination, e.g. "Verhuisd naar teamsite Wonen". */
function tagPill(node) {
  switch (node.tag) {
    case 'to-move':
      return el('span', 'pill pill--brand', node.site_name ? `Verhuisd naar teamsite ${node.site_name}` : 'Verhuisd naar de teamsite');
    case 'duplicate':
      return el('span', 'pill pill--muted', 'Kopie opgeruimd (in prullenbak)');
    case 'moved':
      return el('span', 'pill pill--success', 'Verhuisd vanuit je OneDrive');
    default:
      return null;
  }
}

/** One tree node (recursive). Folders use <details> for native, accessible collapse. */
function renderNode(node, { openFolders }) {
  const li = el('li');
  if (node.type === 'file') {
    const row = append(el('div', `tree-row is-file${node.tag ? ` is-tagged-${node.tag}` : ''}`),
      fileIcon(node.name), el('span', 'tree-name', node.name), tagPill(node));
    row.title = `${formatSize(node.size_mb)}${node.shared > 0 ? ' · gedeeld bestand' : ''}`;
    return append(li, row);
  }

  const details = el('details');
  const hasTagged = node.children.some((c) => c.tag || c.children?.some((cc) => cc.tag));
  details.open = node.type === 'shortcut' || openFolders || hasTagged;
  const row = append(el('div', `tree-row${node.type === 'shortcut' ? ' is-shortcut' : ''}`),
    icon(node.type === 'shortcut' ? 'shortcut' : 'folder'), el('span', 'tree-name', node.name));
  if (node.is_new) row.append(el('span', 'pill pill--brand', 'Nieuw'));
  if (node.is_proposal) row.append(el('span', 'pill pill--muted', 'Voorstel: nog niet toegevoegd'));
  if (node.type === 'folder') row.append(el('span', 'small muted', `(${node.children.length + (node.more ?? 0)})`));

  const ul = el('ul');
  for (const child of node.children) ul.append(renderNode(child, { openFolders: false }));
  if (node.more) ul.append(el('li', 'tree-more', `… en ${node.more} meer`));
  if (node.children.length === 0) ul.append(el('li', 'tree-more', 'leeg'));
  return append(li, append(details, append(el('summary'), row), ul));
}

/** A Windows-Explorer-like window frame around a tree. */
function renderWindow(container, items, rootName, { openFolders }) {
  const tree = el('ul', 'tree');
  tree.setAttribute('aria-label', rootName);
  for (const node of items) tree.append(renderNode(node, { openFolders }));
  renderExplorerWindow(container, rootName, tree);
}

/** @param {object} ctx shared app context (see app.js) */
export function createPreview(ctx) {
  return {
    async load() {
      if (!ctx.me.admin_consent_granted) {
        $('explorer-before').replaceChildren();
        $('explorer-after').replaceChildren();
        $('explorer-summary').textContent = '';
        return;
      }
      const view = await api.explorer();
      renderWindow($('explorer-before'), view.before.items, view.root_name, { openFolders: true });
      renderWindow($('explorer-after'), view.after.items, view.root_name, { openFolders: true });
      const removed = view.before.personal_file_count - view.after.personal_file_count;
      $('explorer-summary').textContent = view.shortcuts_mapped === 0
        ? 'Je teammap in "Na" is een voorstel. Voeg hem toe via Bestanden › Mijn SharePoint-sites › "Snelkoppeling toevoegen".'
        : `${plural(removed, 'bestand', 'bestanden')} minder in je persoonlijke OneDrive · ${plural(view.shortcuts_mapped, 'teammap', 'teammappen')} met 1 klik bereikbaar.`;
    },
  };
}
