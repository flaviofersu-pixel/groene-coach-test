/**
 * @file explorer.js
 * @description The "Verkenner" tab: SharePoint Mapper + before/after preview.
 *
 * Shows how the user's OneDrive looks in Windows Explorer (via the standard
 * OneDrive sync client) before and after the coach: loose shared files gone,
 * the department library available with one click as a shortcut.
 * The preview is rendered in the browser; nothing on the laptop is modified.
 */

import { api } from './api.js';
import { el, append, button, icon, fileIcon, toast } from './dom.js';
import { formatSize, plural } from './format.js';

const $ = (id) => document.getElementById(id);

const TAG_LABELS = {
  'to-move': ['pill pill--warning', 'hoort op SharePoint'],
  duplicate: ['pill pill--warning', 'dubbele kopie'],
  moved: ['pill pill--success', 'verhuisd'],
};

/** @param {object} ctx shared app context (see app.js) */
export function createExplorer(ctx) {
  /** One tree node (recursive). Folders use <details> for native, accessible collapse. */
  function renderNode(node, { openFolders }) {
    const li = el('li');
    if (node.type === 'file') {
      const row = append(el('div', `tree-row is-file${node.tag ? ` is-tagged-${node.tag}` : ''}`),
        fileIcon(node.name), el('span', 'tree-name', node.name));
      row.title = `${formatSize(node.size_mb)}${node.shared > 0 ? ' · gedeeld bestand' : ''}`;
      if (node.tag) row.append(el('span', TAG_LABELS[node.tag][0], TAG_LABELS[node.tag][1]));
      return append(li, row);
    }

    const details = el('details');
    const hasTagged = node.children.some((c) => c.tag || c.children?.some((cc) => cc.tag));
    details.open = node.type === 'shortcut' || openFolders || hasTagged;
    const row = append(el('div', `tree-row${node.type === 'shortcut' ? ' is-shortcut' : ''}`),
      icon(node.type === 'shortcut' ? 'shortcut' : 'folder'), el('span', 'tree-name', node.name));
    if (node.is_new) row.append(el('span', 'pill pill--brand', 'Nieuw'));
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
    container.replaceChildren(
      append(el('div', 'explorer-titlebar'), el('span', '', 'Verkenner'), el('span', 'explorer-dots', '— ▢ ✕')),
      append(el('div', 'explorer-address'), icon('cloud'), el('span', '', `› ${rootName}`)),
      append(el('div', 'explorer-tree'), tree));
  }

  function renderSites() {
    const list = $('site-list');
    list.replaceChildren();
    for (const site of ctx.me.sites) {
      const action = site.mapped
        ? el('span', 'pill pill--success', '✓ In je OneDrive')
        : button('Toon map in Verkenner', 'btn btn-primary btn-sm', async (e) => {
          e.currentTarget.disabled = true;
          try {
            const r = await api.mapShortcut(site.id);
            toast(`"${r.shortcut.name}" staat nu in je OneDrive en in Verkenner.`);
            await ctx.refreshAll();
          } catch (err) {
            toast(err.message);
            e.currentTarget.disabled = false;
          }
        });
      list.append(append(el('li', 'site-card'), icon('shortcut'),
        append(el('div', 'site-card-main'),
          el('div', 'site-card-name', `${site.display_name} › ${site.library_name}`),
          el('div', 'site-card-meta', site.department ? `Afdelingssite · ${site.role === 'owner' ? 'eigenaar' : 'lid'}` : 'Programmasite (afdelingsoverstijgend)')),
        action));
    }
    if (ctx.me.sites.length === 0) list.append(el('li', 'empty', 'Geen SharePoint-sites beschikbaar (toestemming ontbreekt).'));
  }

  return {
    async load() {
      renderSites();
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
        ? 'Tip: klik op "Toon map in Verkenner" om je afdelingsmap toe te voegen.'
        : `${plural(removed, 'bestand', 'bestanden')} minder in je persoonlijke OneDrive · ${plural(view.shortcuts_mapped, 'SharePoint-map', 'SharePoint-mappen')} met 1 klik bereikbaar.`;
    },
  };
}
