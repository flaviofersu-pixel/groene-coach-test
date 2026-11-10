/**
 * @file impact.js
 * @description Feature C: the metaphor dashboard (collective impact).
 *
 * Savings are shown per TEAM (as people know them from Microsoft Teams), never
 * per department: a move counts for the team the document went to.
 * Every number is a band from the API. The team chart draws each band as an
 * interval bar (low -> high) on one shared axis, so uncertainty is visible
 * instead of hidden. A table view carries the same data.
 */

import { api } from './api.js';
import { el, append } from './dom.js';
import { formatSize, formatNumber, plural } from './format.js';
import { co2Amount, co2Text, co2InfoButton } from './co2.js';

const $ = (id) => document.getElementById(id);

/** @param {object} ctx shared app context (see app.js) */
export function createImpact(ctx) {
  const state = { data: null, scope: 'organisation' };
  const tooltip = $('tooltip');

  function kpi(label, value, sub) {
    const valueNode = typeof value === 'string' ? el('p', 'kpi-value', value) : append(el('div', 'kpi-value'), value);
    return append(el('article', 'kpi'), el('h3', 'kpi-label', label), valueNode, el('p', 'kpi-sub', sub));
  }

  /** A tile without a saving yet: say what you can do instead of "0 gram CO₂". */
  const emptyKpi = (label, text) => append(el('article', 'kpi'), el('h3', 'kpi-label', label), el('p', 'kpi-empty', text));

  function renderKpis({ personal, my_teams: myTeams, organisation }) {
    const mail = organisation.email_cloning;
    const hasPersonal = personal.actions > 0 && personal.co2_per_year.high > 0;
    const hasTeams = !myTeams.suppressed && myTeams.migrations > 0;
    $('impact-kpis').replaceChildren(
      hasPersonal
        ? kpi('Jouw bijdrage (alleen voor jou)', co2Amount(personal.co2_per_year, { suffix: '' }),
          `per jaar · ${plural(personal.actions, 'actie', 'acties')}`)
        : emptyKpi('Jouw bijdrage (alleen voor jou)', 'Nog niets bespaard. Begin met een actie in de Actie-hub.'),
      hasTeams
        ? kpi('Jouw teams', co2Amount(myTeams.co2_per_year, { suffix: '' }),
          `per jaar · ${plural(myTeams.migrations, 'document', 'documenten')} naar de teamsite verhuisd`)
        : emptyKpi('Jouw teams', myTeams.suppressed ? myTeams.reason : 'Nog geen documenten naar je teamsites verhuisd.'),
      // The main total of this screen: the only one with the everyday example and an "i".
      kpi('Hele gemeente', co2Amount(organisation.co2_per_year, { suffix: '', stacked: true, example: true, info: true }),
        `per jaar · ${organisation.migrations} verhuizingen · ${organisation.mail_links} links i.p.v. bijlagen`),
      kpi('Bijlagen-klonen (gemeente)', formatSize(mail.duplicate_mb),
        `${mail.attachments} bijlagen gemiddeld ${formatNumber(mail.average_amplification, 1)}× opgeslagen · ${co2Text(mail.co2_per_year)}`));
  }

  /** A plain card: a value and one line of text (no decorative icons). */
  function metaphor(value, text) {
    return append(el('article', 'metaphor'),
      append(el('div'), el('p', 'metaphor-value', value), el('p', 'metaphor-text', text)));
  }

  /** Realistic municipal comparisons; never inflated. */
  function renderMetaphors() {
    const scopeData = state.data[state.scope];
    const container = $('metaphors');
    if (scopeData.suppressed) {
      container.replaceChildren(el('p', 'empty', scopeData.reason));
      return;
    }
    // Only one kind of everyday example in the app (phone charging, on the main total).
    const cards = [];
    if (state.scope === 'my_teams') {
      // Teams only get savings from documents moved to their team site.
      cards.push(metaphor(plural(scopeData.migrations, 'document', 'documenten'),
        'verhuisd naar de teamsites van je teams. Daar kunnen collega\'s erbij en wordt alles bewaard volgens de bewaarregels.'));
    } else {
      const mail = scopeData.email_cloning;
      cards.push(
        metaphor(`${formatNumber(mail.average_amplification, 1)}× opslag`,
          `Zo vaak wordt een gemiddelde bijlage opgeslagen: ${formatSize(mail.duplicate_mb)} aan kopieën in mailboxen (${co2Text(mail.co2_per_year)}). Met een link is dat een bestand.`),
        metaphor(`${formatSize(scopeData.storage_freed_mb)} opgeruimd`,
          `Alleen identieke kopieën opruimen bespaart opslag. Daarnaast ${formatSize(scopeData.storage_avoided_mb)} aan mailbijlagen voorkomen met links.`));
    }
    container.replaceChildren(...cards);
  }

  function showTooltip(row, d, x, y) {
    tooltip.replaceChildren(
      el('strong', '', d.name),
      el('div', '', co2Text(d.co2_per_year)),
      el('div', '', `${plural(d.actions, 'document', 'documenten')} naar de teamsite verhuisd`));
    tooltip.hidden = false;
    const rect = row.getBoundingClientRect();
    const px = x ?? rect.left + rect.width / 2;
    const py = y ?? rect.top;
    tooltip.style.left = `${Math.min(Math.max(8, px + 12), window.innerWidth - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${Math.max(8, py - tooltip.offsetHeight - 10)}px`;
  }
  const hideTooltip = () => { tooltip.hidden = true; };

  /** Interval bars: one shared axis from 0 to the largest upper bound. */
  function renderChart(teams) {
    const max = Math.max(...teams.map((d) => d.co2_high_g), 1);
    const chart = $('team-chart');
    chart.replaceChildren();
    for (const d of teams) {
      const row = el('div', `range-row${d.is_mine ? ' is-mine' : ''}`);
      row.setAttribute('role', 'listitem');
      row.tabIndex = 0;
      row.setAttribute('aria-label', `${d.name}: ${co2Text(d.co2_per_year)}`);
      const bar = el('div', 'range-bar');
      bar.style.setProperty('--lo', String(d.co2_low_g / max));
      bar.style.setProperty('--hi', String(d.co2_high_g / max));
      append(row, el('span', 'range-label', d.name), append(el('div', 'range-track'), bar),
        append(el('span', 'range-value'), co2Amount(d.co2_per_year, { suffix: '' })));
      row.addEventListener('pointermove', (e) => showTooltip(row, d, e.clientX, e.clientY));
      row.addEventListener('pointerleave', hideTooltip);
      row.addEventListener('focus', () => showTooltip(row, d));
      row.addEventListener('blur', hideTooltip);
      chart.append(row);
    }
    $('team-table').replaceChildren(...teams.map((d) => append(el('tr'),
      el('td', '', d.name + (d.is_mine ? ' (jouw team)' : '')),
      el('td', 'num', String(d.actions)),
      el('td', 'num', formatNumber(d.co2_low_g, 2)),
      el('td', 'num', formatNumber(d.co2_high_g, 2)))));
  }

  // One explanation button for the whole chart; every row shows its own example label.
  $('chart-title').after(co2InfoButton());

  // One-time wiring of the scope switch and the table toggle.
  document.querySelectorAll('[data-scope]').forEach((btn) => btn.addEventListener('click', () => {
    state.scope = btn.dataset.scope;
    document.querySelectorAll('[data-scope]').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    if (state.data) renderMetaphors();
  }));
  $('toggle-table').addEventListener('click', (e) => {
    const showTable = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(showTable));
    e.currentTarget.textContent = showTable ? 'Grafiek' : 'Tabel';
    $('team-chart').hidden = showTable;
    $('chart-key').hidden = showTable;
    $('team-table-wrap').hidden = !showTable;
  });

  return {
    async load() {
      state.data = await api.impact();
      renderKpis(state.data);
      renderMetaphors();
      renderChart(state.data.teams);
      $('privacy-note').textContent = `${state.data.privacy.note} Teams met minder dan ${state.data.privacy.min_group_size} leden vallen onder "Overige teams".`;
    },
  };
}
