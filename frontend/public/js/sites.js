/**
 * @file sites.js
 * @description Verkenner part "Mijn SharePoint-sites": the teams and sites the
 * user is a member of, so they know where files can go. Each site can be added
 * to OneDrive with one click ("Toon map in Verkenner", OneDrive's standard
 * "Add shortcut to My files"; nothing is installed on the laptop).
 *
 * TODO(teams): list the user's teams with GET /me/joinedTeams (Team.ReadBasic.All)
 * and each team's library with GET /groups/{id}/drive (Files.Read.All). Both are
 * broader than strictly minimal; see the feasibility table.
 */

import { api } from './api.js';
import { el, append, button, icon, toast } from './dom.js';
import { siteLabel } from './moveDialog.js';

const $ = (id) => document.getElementById(id);

/** @param {object} ctx shared app context (see app.js) */
export function createSites(ctx) {
  async function addShortcut(site, btn) {
    btn.disabled = true;
    try {
      const r = await api.mapShortcut(site.id);
      toast(`"${r.shortcut.name}" staat nu in je OneDrive en in Verkenner.`);
      await ctx.refreshAll();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  }

  function siteCard(site) {
    const action = site.mapped
      ? el('span', 'pill pill--success', '✓ In je OneDrive')
      : button('Toon map in Verkenner', 'btn btn-primary btn-sm', (e) => addShortcut(site, e.currentTarget));
    return append(el('li', 'site-card'), icon('shortcut'),
      append(el('div', 'site-card-main'),
        el('div', 'site-card-name', siteLabel(site)),
        el('div', 'site-card-meta', site.department
          ? `Teamsite · je bent ${site.role === 'owner' ? 'eigenaar' : 'lid'}`
          : `Programmasite · je bent ${site.role === 'owner' ? 'eigenaar' : 'lid'}`)),
      action);
  }

  return {
    async load() {
      const list = $('site-list');
      list.replaceChildren(...ctx.me.sites.map(siteCard));
      if (ctx.me.sites.length === 0) list.append(el('li', 'empty', 'Geen SharePoint-sites beschikbaar (toestemming ontbreekt).'));
    },
  };
}
