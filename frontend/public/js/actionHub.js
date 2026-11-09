/**
 * @file actionHub.js
 * @description The "Actie-hub" tab.
 *
 *  Feature A  list of own OneDrive files with times_shared > 2
 *  Feature B  the nudge card with the exact coaching copy, "Ja, verhuis het" / "Nu niet"
 *  Extra      duplicate chains with user-confirmed clean-up (+ undo)
 *
 * Autonomy: every action starts with a click by the civil servant; clean-up
 * additionally requires a confirmation dialog, and can be undone.
 */

import { api } from './api.js';
import { el, append, button, fileIcon, toast } from './dom.js';
import { formatSize, formatRelative, firstName, plural } from './format.js';

const $ = (id) => document.getElementById(id);

/** @param {object} ctx shared app context (see app.js) */
export function createActionHub(ctx) {
  const state = { files: [], chains: [], currentId: null, snoozedCount: 0 };

  const departmentSite = () => ctx.me.sites.find((s) => s.department === ctx.me.user.department) ?? ctx.me.sites[0];

  // --- Feature B: nudge -----------------------------------------------------------

  function renderNudge() {
    const slot = $('nudge-slot');
    const file = state.files.find((f) => f.id === state.currentId) ?? state.files[0];
    if (!file) {
      slot.replaceChildren(append(el('div', 'nudge'),
        el('span', 'nudge-avatar', '🌿'),
        append(el('div'),
          el('p', 'nudge-title', 'Alles staat op de juiste plek'),
          el('p', 'nudge-text', 'Je hebt geen intensief gedeelde bestanden meer in je OneDrive. Dank je wel!'))));
      return;
    }
    state.currentId = file.id;

    const body = el('div');
    append(body,
      el('p', 'nudge-from', 'Groene Coach · nu'),
      // Exact copy from the brief, personalised with the first name.
      el('h2', 'nudge-title', `Samen groener werken, ${firstName(ctx.me.user.display_name)}? 🌿`),
      el('p', 'nudge-text', 'Dit bestand wordt intensief gedeeld met je team. Zullen we het verhuizen naar SharePoint? Zo staat het direct op de wettelijk juiste plek voor de Archiefwet en besparen we netwerk- en back-up-energie.'));

    const chip = append(el('div', 'nudge-file'), fileIcon(file.filename),
      append(el('div'),
        el('div', 'nudge-file-name', file.filename),
        el('div', 'nudge-file-meta',
          `Gedeeld met ${file.times_shared} collega's · ${formatSize(file.size_mb)} · gewijzigd ${formatRelative(file.last_modified)} · map ${file.folder}`)));

    const estimate = el('p', 'nudge-estimate', 'Geschatte besparing: ');
    append(estimate, el('strong', '', `${file.estimate.co2_per_year.label} per jaar`));

    const details = el('details', 'nudge-details');
    const list = el('ul');
    append(list,
      el('li', '', `Opslag: ${file.estimate.breakdown.storage.label}. ${file.estimate.breakdown.storage.note}`),
      el('li', '', `Synchronisatie: ${file.estimate.breakdown.sync.label}`),
      el('li', '', `Back-up: ${file.estimate.breakdown.backup.label}`),
      el('li', '', file.activity === 'active'
        ? 'Het bestand is recent gewijzigd, dus er is actief sync-verkeer.'
        : 'Het bestand is al een tijd niet gewijzigd, dus de besparing is klein.'));
    append(details, el('summary', '', 'Waarom een bandbreedte?'), list,
      el('p', '', 'We rekenen met een onder- en bovengrens, omdat exacte cijfers schijnzekerheid geven.'));

    // Destination: department site by default, other memberships selectable.
    const select = el('select', 'sim-select');
    select.setAttribute('aria-label', 'Doel-SharePoint-site');
    for (const s of ctx.me.sites) select.append(new Option(`${s.display_name} › ${s.library_name}`, s.id, false, s.id === departmentSite()?.id));
    const target = append(el('label', 'nudge-target'), el('span', '', 'Naar:'), select);

    const error = el('p', 'nudge-error');
    error.hidden = true;
    error.setAttribute('role', 'alert');

    const yes = button('Ja, verhuis het', 'btn btn-primary');
    const no = button('Nu niet', 'btn btn-secondary');
    yes.addEventListener('click', () => migrate(file, select.value, { yes, no, error }));
    no.addEventListener('click', () => snooze(file, { yes, no }));

    append(body, chip, estimate, details, target, error, append(el('div', 'nudge-actions'), yes, no));
    slot.replaceChildren(append(el('article', 'nudge'), el('span', 'nudge-avatar', '🌿'), body));
  }

  /** Green checkmark state after a successful move. */
  function renderDone(result) {
    const site = ctx.me.sites.find((s) => s.id === result.site.id);
    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.setAttribute('viewBox', '0 0 48 48');
    check.setAttribute('class', 'check');
    check.setAttribute('aria-hidden', 'true');
    const circle = document.createElementNS(check.namespaceURI, 'circle');
    circle.setAttribute('cx', '24'); circle.setAttribute('cy', '24'); circle.setAttribute('r', '22');
    const path = document.createElementNS(check.namespaceURI, 'path');
    path.setAttribute('d', 'M14 25 l7 7 l13 -15');
    check.append(circle, path);

    const showFolder = button(site?.mapped ? 'Bekijk in Verkenner' : 'Toon map in Verkenner', 'btn btn-primary', async () => {
      try {
        if (!site?.mapped) {
          await api.mapShortcut(result.site.id);
          await ctx.refreshAll();
        }
        ctx.showTab('tab-explorer');
      } catch (err) {
        toast(err.message);
      }
    });
    const nextBtn = button('Volgende suggestie', 'btn btn-secondary', () => { state.currentId = null; renderNudge(); });

    const body = append(el('div'),
      el('h2', 'nudge-title', `Verhuisd naar SharePoint · ${result.site.display_name}`),
      el('p', 'nudge-text', `${result.file.filename} staat nu op de wettelijk juiste plek. Geschatte besparing: ${result.estimate.co2_per_year.label} per jaar. ${result.storage_note}`),
      append(el('div', 'nudge-actions'), showFolder, nextBtn));
    $('nudge-slot').replaceChildren(append(el('article', 'nudge'), append(el('div', 'nudge-done'), check), body));
  }

  async function migrate(file, siteId, { yes, no, error }) {
    yes.disabled = true; no.disabled = true;
    yes.textContent = 'Bezig met verhuizen…';
    try {
      const result = await api.migrate(file.id, siteId);
      state.files = state.files.filter((f) => f.id !== file.id);
      state.currentId = null;
      renderList();
      renderDone(result);
      ctx.refreshAll().catch(() => {}); // other tabs + other open windows
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      yes.disabled = false; no.disabled = false;
      yes.textContent = 'Opnieuw proberen';
    }
  }

  /** "Nu niet" is honoured immediately, even if logging the choice fails. */
  async function snooze(file, { yes, no }) {
    yes.disabled = true; no.disabled = true;
    state.files = state.files.filter((f) => f.id !== file.id);
    state.currentId = null;
    try {
      await api.snooze(file.id);
      state.snoozedCount += 1;
      toast(`Prima, ${file.filename} blijft in je OneDrive. We vragen het een week niet opnieuw.`);
    } catch (err) {
      toast(`${file.filename} blijft in je OneDrive.`);
    }
    renderNudge();
    renderList();
  }

  // --- Feature A: list ----------------------------------------------------------------

  function renderList() {
    const list = $('candidate-list');
    list.replaceChildren();
    if (state.files.length === 0) list.append(el('li', 'empty', 'Geen intensief gedeelde bestanden in je OneDrive. 🌿'));
    for (const f of state.files) {
      const row = append(el('li', `file-row${f.id === state.currentId ? ' is-current' : ''}`),
        fileIcon(f.filename),
        append(el('div', 'file-row-main'),
          el('div', 'file-row-name', f.filename),
          el('div', 'file-row-meta', `Gedeeld met ${f.times_shared} · ${formatSize(f.size_mb)} · ${f.activity === 'active' ? 'actief' : 'slapend'}`)),
        el('span', 'file-row-band', f.estimate.co2_per_year.label),
        button('Bekijken', 'btn btn-secondary btn-sm', () => {
          state.currentId = f.id;
          renderNudge();
          renderList();
          $('nudge-slot').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }));
      list.append(row);
    }
    const note = $('snoozed-note');
    note.hidden = state.snoozedCount === 0;
    note.textContent = `${plural(state.snoozedCount, 'bestand', 'bestanden')} tijdelijk verborgen omdat je "Nu niet" koos.`;
  }

  // --- Duplicate chains --------------------------------------------------------------------

  function renderChains() {
    const container = $('chain-list');
    container.replaceChildren();
    if (state.chains.length === 0) container.append(el('p', 'empty', 'Geen dubbele kopieën gevonden.'));

    for (const ch of state.chains) {
      const card = el('article', 'chain');
      append(card,
        append(el('div', 'chain-head'), fileIcon(ch.filename), el('span', 'chain-name', ch.filename)),
        el('p', 'chain-meta',
          `${ch.total_copies} identieke kopieën in de gemeente · ${ch.my_copies.length} bij jou` +
          (ch.colleagues_with_copy ? ` · ${plural(ch.colleagues_with_copy, 'collega heeft', 'collega\'s hebben')} er ook een` : '') +
          ` · ${formatSize(ch.size_mb)} per stuk`),
        el('p', 'chain-meta', ch.master
          ? `Origineel: SharePoint › ${ch.master.site} › ${ch.master.folder}`
          : 'Nog geen centrale versie op SharePoint.'),
        el('p', 'chain-meta', `Verspilling hele reeks: ${ch.chain_waste.co2_per_year.label} per jaar (${formatSize(ch.size_mb * (ch.total_copies - 1))} dubbel).`));

      const copies = el('ul', 'chain-copies');
      for (const c of ch.my_copies) copies.append(el('li', '', `${c.filename} (${c.folder})`));
      card.append(copies);

      const foot = el('div', 'chain-foot');
      if (ch.can_consolidate) {
        foot.append(el('span', 'small muted', `Jij kunt ${formatSize(ch.size_mb * ch.removable_count)} vrijmaken: ${ch.my_saving.co2_per_year.label} per jaar`),
          button('Ruim mijn kopieën op…', 'btn btn-secondary btn-sm', () => confirmConsolidate(ch)));
      } else {
        foot.append(el('span', 'small muted', ch.master
          ? 'Je hebt geen overbodige kopie. Tip: deel voortaan de SharePoint-link.'
          : 'Tip: verhuis jouw versie naar SharePoint en deel de link met je collega\'s.'));
      }
      card.append(foot);
      container.append(card);
    }
  }

  /** Explicit consent dialog before anything goes to the recycle bin. */
  function confirmConsolidate(chain) {
    const dialog = $('confirm-dialog');
    const removable = chain.master ? chain.my_copies : chain.my_copies.slice(1);
    const body = $('confirm-body');
    body.replaceChildren(
      el('p', '', chain.master
        ? `Het origineel blijft bewaard op SharePoint (${chain.master.site}). Deze kopieën uit jouw OneDrive gaan naar je prullenbak:`
        : `"${chain.my_copies[0].filename}" wordt eerst verhuisd naar SharePoint als centrale versie. Deze kopieën gaan naar je prullenbak:`),
      append(el('ul'), ...removable.map((c) => el('li', '', `${c.filename} (${c.folder})`))),
      el('p', '', 'Je kunt ze 93 dagen lang terugzetten. Kopieën van collega\'s blijven onaangeroerd.'));

    const ok = $('confirm-ok');
    const cancel = $('confirm-cancel');
    const close = () => { dialog.close(); ok.onclick = null; cancel.onclick = null; };
    cancel.onclick = close;
    ok.onclick = async () => {
      close();
      try {
        const result = await api.consolidate(chain.content_hash);
        toast(`${plural(result.recycled.length, 'kopie', 'kopieën')} naar de prullenbak · ${result.estimate.co2_per_year.label} per jaar bespaard.`, {
          actionLabel: 'Ongedaan maken',
          ms: 10_000,
          onAction: async () => {
            for (const r of result.recycled) await api.restore(r.id);
            toast('Teruggezet. Er is niets verloren gegaan.');
            await ctx.refreshAll();
          },
        });
        await ctx.refreshAll();
      } catch (err) {
        toast(err.message);
      }
    };
    dialog.showModal();
  }

  return {
    async load() {
      $('hub-greeting').textContent = `Hoi ${firstName(ctx.me.user.display_name)} 👋`;
      if (!ctx.me.admin_consent_granted) {
        state.files = []; state.chains = [];
        $('nudge-slot').replaceChildren();
        renderList(); renderChains();
        return;
      }
      const [scan, chains] = await Promise.all([api.scan(), api.chains()]);
      state.files = scan.files;
      state.snoozedCount = scan.snoozed_count;
      state.chains = chains.chains;
      if (!state.files.some((f) => f.id === state.currentId)) state.currentId = null;
      renderNudge();
      renderList();
      renderChains();
    },
  };
}
