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
import { formatNumber, plural } from './format.js';
import { co2Amount, co2Text, co2InfoButton } from './co2.js';

const $ = (id) => document.getElementById(id);

/** @param {object} ctx shared app context (see app.js) */
export function createImpact(ctx) {
  const state = { data: null };
  const tooltip = $('tooltip');

  function kpi(label, value, sub) {
    const valueNode = typeof value === 'string' ? el('p', 'kpi-value', value) : append(el('div', 'kpi-value'), value);
    return append(el('article', 'kpi'), el('h3', 'kpi-label', label), valueNode, el('p', 'kpi-sub', sub));
  }

  /** A tile without a saving yet: say what you can do instead of "0 gram CO₂". */
  const emptyKpi = (label, text) => append(el('article', 'kpi'), el('h3', 'kpi-label', label), el('p', 'kpi-empty', text));

  function renderKpis({ personal, my_teams: myTeams, organisation }) {
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
        `per jaar · ${plural(organisation.migrations, 'document', 'documenten')} verhuisd · ` +
        `${plural(organisation.mail_links, 'keer', 'keer')} een link gestuurd in plaats van een bijlage`));
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
        // Nothing saved yet: say so instead of "0 gram CO₂".
        d.co2_high_g > 0
          ? append(el('span', 'range-value'), co2Amount(d.co2_per_year, { suffix: '' }))
          : el('span', 'range-value muted', 'Nog niets verhuisd'));
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

  // One-time wiring of the table toggle.
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
      renderChart(state.data.teams);
      $('privacy-note').textContent = `Opgeteld per team, zonder namen. Een verhuizing telt mee bij het team waar het document naartoe gaat. Teams met minder dan ${state.data.privacy.min_group_size} leden vallen onder "Overige teams".`;
    },
  };
}
