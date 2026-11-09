/**
 * @file impact.js
 * @description Feature C: the metaphor dashboard (collective impact).
 *
 * Every number is a band from the API. The department chart draws each band
 * as an interval bar (low -> high) on one shared axis, so uncertainty is
 * visible instead of hidden. A table view carries the same data.
 */

import { api } from './api.js';
import { el, append } from './dom.js';
import { formatSize, formatNumber, plural } from './format.js';

const $ = (id) => document.getElementById(id);

/** @param {object} ctx shared app context (see app.js) */
export function createImpact(ctx) {
  const state = { data: null, scope: 'organisation' };
  const tooltip = $('tooltip');

  function kpi(label, value, sub) {
    return append(el('article', 'kpi'), el('h3', 'kpi-label', label), el('p', 'kpi-value', value), el('p', 'kpi-sub', sub));
  }

  function renderKpis({ personal, department, organisation }) {
    const mail = organisation.email_cloning;
    $('impact-kpis').replaceChildren(
      kpi('Jouw bijdrage (alleen voor jou)', personal.co2_per_year.label,
        `per jaar · ${plural(personal.actions, 'actie', 'acties')} · ${formatSize(personal.mb_moved)} verhuisd · ${formatSize(personal.storage_freed_mb)} opgeruimd`),
      department.suppressed
        ? kpi(`Afdeling ${department.name}`, 'Niet getoond', department.reason)
        : kpi(`Afdeling ${department.name}`, department.co2_per_year.label,
          `per jaar · ${department.members} collega's · ${plural(department.migrations, 'verhuizing', 'verhuizingen')}`),
      kpi('Hele gemeente', organisation.co2_per_year.label,
        `per jaar · ${organisation.migrations} verhuizingen · ${organisation.mail_links} links i.p.v. bijlagen`),
      kpi('Bijlagen-klonen (gemeente)', formatSize(mail.duplicate_mb),
        `${mail.attachments} bijlagen gemiddeld ${formatNumber(mail.average_amplification, 1)}× opgeslagen · ${mail.co2_per_year.label} per jaar`));
  }

  function metaphor(iconText, value, text) {
    return append(el('article', 'metaphor'), el('span', 'metaphor-icon', iconText),
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
    const eq = scopeData.equivalents;
    const mail = scopeData.email_cloning;
    container.replaceChildren(
      metaphor('🏮', `${eq.lamp_hours.label} lantaarnuren`,
        'Zoveel grachtenlantaarns (LED, 40 W) kun je één uur laten branden op de bespaarde stroom per jaar.'),
      metaphor('❄️', eq.cooling_kwh.label,
        'Daarvan is koeling en overhead in datacenters (PUE 1,185). Netwerkverkeer telt hier niet mee.'),
      metaphor('📧', `${formatNumber(mail.average_amplification, 1)}× opslag`,
        `Zo vaak wordt een gemiddelde bijlage opgeslagen: ${formatSize(mail.duplicate_mb)} aan kopieën in mailboxen (${mail.co2_per_year.label} per jaar). Met een link is dat één bestand.`),
      metaphor('🗂️', `${formatSize(scopeData.storage_freed_mb)} opgeruimd`,
        `Alleen identieke kopieën opruimen bespaart opslag. Daarnaast ${formatSize(scopeData.storage_avoided_mb)} aan mailbijlagen voorkomen met links.`));
  }

  function showTooltip(row, d, x, y) {
    tooltip.replaceChildren(
      el('strong', '', d.name),
      el('div', '', `${d.co2_per_year.label} per jaar`),
      el('div', '', `${plural(d.actions, 'actie', 'acties')} (verhuizingen, opgeruimde kopieën, links)`));
    tooltip.hidden = false;
    const rect = row.getBoundingClientRect();
    const px = x ?? rect.left + rect.width / 2;
    const py = y ?? rect.top;
    tooltip.style.left = `${Math.min(Math.max(8, px + 12), window.innerWidth - tooltip.offsetWidth - 8)}px`;
    tooltip.style.top = `${Math.max(8, py - tooltip.offsetHeight - 10)}px`;
  }
  const hideTooltip = () => { tooltip.hidden = true; };

  /** Interval bars: one shared axis from 0 to the largest upper bound. */
  function renderChart(departments) {
    const max = Math.max(...departments.map((d) => d.co2_high_g), 1);
    const chart = $('dept-chart');
    chart.replaceChildren();
    for (const d of departments) {
      const row = el('div', `range-row${d.is_mine ? ' is-mine' : ''}`);
      row.setAttribute('role', 'listitem');
      row.tabIndex = 0;
      row.setAttribute('aria-label', `${d.name}: ${d.co2_per_year.label} per jaar`);
      const bar = el('div', 'range-bar');
      bar.style.setProperty('--lo', String(d.co2_low_g / max));
      bar.style.setProperty('--hi', String(d.co2_high_g / max));
      append(row, el('span', 'range-label', d.name), append(el('div', 'range-track'), bar), el('span', 'range-value', d.co2_per_year.label));
      row.addEventListener('pointermove', (e) => showTooltip(row, d, e.clientX, e.clientY));
      row.addEventListener('pointerleave', hideTooltip);
      row.addEventListener('focus', () => showTooltip(row, d));
      row.addEventListener('blur', hideTooltip);
      chart.append(row);
    }
    $('dept-table').replaceChildren(...departments.map((d) => append(el('tr'),
      el('td', '', d.name + (d.is_mine ? ' (jouw afdeling)' : '')),
      el('td', 'num', String(d.actions)),
      el('td', 'num', formatNumber(d.co2_low_g, 2)),
      el('td', 'num', formatNumber(d.co2_high_g, 2)))));
  }

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
    $('dept-chart').hidden = showTable;
    $('chart-key').hidden = showTable;
    $('dept-table-wrap').hidden = !showTable;
  });

  return {
    async load() {
      state.data = await api.impact();
      renderKpis(state.data);
      renderMetaphors();
      renderChart(state.data.departments);
      $('privacy-note').textContent = `🔒 ${state.data.privacy.note} Afdelingen met minder dan ${state.data.privacy.min_group_size} collega's vallen onder "Overige afdelingen".`;
    },
  };
}
