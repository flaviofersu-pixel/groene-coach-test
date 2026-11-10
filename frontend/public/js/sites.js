/**
 * @file sites.js
 * @description Bestanden part "Mijn SharePoint-sites": the teams and sites the
 * user is a member of, so they know where files can go.
 *
 * Per site: open it in SharePoint, or add it to OneDrive with Microsoft's own
 * feature "Snelkoppeling toevoegen aan Mijn bestanden" (Add shortcut to My files).
 * Nothing is installed on the laptop.
 *
 * TODO(teams): list the user's teams with GET /me/joinedTeams (Team.ReadBasic.All),
 * each team's library with GET /groups/{id}/drive (Files.Read.All) and its address
 * with GET /groups/{id}/sites/root -> webUrl. Inside Teams, open that address with
 * TeamsJS `app.openLink(webUrl)` instead of a plain link.
 */

import { api } from './api.js';
import { el, append, button, icon, fileIcon, toast } from './dom.js';
import { lastEditedLabel } from './format.js';
import { siteLabel } from './moveDialog.js';
import { renderExplorerWindow, folderNode } from './explorerWindow.js';

/**
 * The demo data uses invented addresses on the reserved `.example` domain, which
 * do not exist on the internet. Opening one would show "site not reachable".
 */
const isDemoAddress = (url) => {
  try { return new URL(url).hostname.endsWith('.example'); } catch { return true; }
};

const $ = (id) => document.getElementById(id);

/** @param {object} ctx shared app context (see app.js) */
export function createSites(ctx) {
  async function addShortcut(site, btn) {
    btn.disabled = true;
    try {
      const r = await api.mapShortcut(site.id);
      toast(`"${r.shortcut.name}" staat nu in Mijn bestanden in je OneDrive.`);
      await ctx.refreshAll();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  }

  /**
   * Demo only: shows the site's library (folders + files) in a dialog, because the
   * demo address does not exist. The real version opens SharePoint instead.
   */
  async function showSitePreview(site) {
    const dialog = document.getElementById('site-dialog');
    document.getElementById('site-dialog-title').textContent = `Teamsite ${site.display_name}`;
    const { sites } = await api.sharePointTree();
    const library = sites.find((s) => s.id === site.id);

    const tree = el('ul', 'tree');
    tree.setAttribute('aria-label', siteLabel(site));
    for (const folder of library?.folders ?? []) {
      const node = folderNode({ name: folder.name, count: folder.files.length + folder.more, open: folder.files.length > 0 });
      for (const f of folder.files) {
        node.list.append(append(el('li'), append(el('div', 'tree-row is-file sp-file'),
          fileIcon(f.name), el('span', 'tree-name', f.name), el('span', 'tree-file-meta', lastEditedLabel(f.last_modified)))));
      }
      if (folder.files.length === 0) node.list.append(el('li', 'tree-more', 'leeg'));
      tree.append(node.li);
    }
    renderExplorerWindow(document.getElementById('site-dialog-tree'), siteLabel(site), tree, { addressIcon: 'shortcut' });
    document.getElementById('site-dialog-close').onclick = () => dialog.close();
    dialog.showModal();
  }

  /**
   * "Openen in SharePoint": a real address opens in a new browser tab;
   * a demo address opens the preview instead (see isDemoAddress).
   */
  function openLink(site) {
    if (isDemoAddress(site.web_url)) {
      return button('Openen in SharePoint', 'btn btn-secondary btn-sm', () => showSitePreview(site).catch((err) => toast(err.message)));
    }
    const link = el('a', 'btn btn-secondary btn-sm', 'Openen in SharePoint');
    link.href = site.web_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer'; // the new tab cannot reach back into this page
    return link;
  }

  /** One card: the name gets the full width, the buttons go on their own line below it. */
  function siteCard(site) {
    const role = site.role === 'owner' ? 'eigenaar' : 'lid';
    const shortcut = site.mapped
      ? el('span', 'pill pill--success', '✓ In Mijn bestanden')
      : button('Snelkoppeling toevoegen', 'btn btn-primary btn-sm', (e) => addShortcut(site, e.currentTarget));
    shortcut.title = 'Snelkoppeling toevoegen aan Mijn bestanden: de teammap staat dan ook in je OneDrive';

    return append(el('li', 'site-card'),
      append(el('div', 'site-card-head'), icon('shortcut'), el('div', 'site-card-name', siteLabel(site))),
      el('div', 'site-card-meta', `${site.department ? 'Teamsite' : 'Programmasite'} · je bent ${role}`),
      append(el('div', 'site-card-actions'), shortcut, openLink(site)));
  }

  return {
    async load() {
      const list = $('site-list');
      list.replaceChildren(...ctx.me.sites.map(siteCard));
      if (ctx.me.sites.length === 0) list.append(el('li', 'empty', 'Geen SharePoint-sites beschikbaar (toestemming ontbreekt).'));
    },
  };
}
