/**
 * @file dashboard.js
 * @description The Teams-embedded dashboard tab.
 *
 * Data source: GET /api/stats/co2-saved?user=<id>. The page re-fetches when
 *  - the widget broadcasts a migration (BroadcastChannel, instant),
 *  - the tab becomes visible again,
 *  - every 30 seconds (other users migrating).
 *
 * All DOM output uses textContent, so data can never inject markup.
 */

import { api, getCurrentUserId, setupUserSelect, updates } from './api.js';
import {
  formatCo2, formatSize, formatNumber, formatDuration, formatDistance, formatDate,
} from './format.js';

const REFRESH_MS = 30_000;
/** Average burning hours per night of a canal lantern (mirrors the backend factor). */
const LANTERN_HOURS_PER_NIGHT = 11.2;

const $ = (id) => document.getElementById(id);

const state = {
  userId: getCurrentUserId(),
  /** @type {any} last API response */
  data: null,
  /** Which totals the metaphors use: 'user' | 'department' | 'total'. */
  scope: 'user',
};

/** Creates an element with optional class and text. */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Dutch greeting based on the time of day. */
function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
  return `${part}, ${name.split(' ')[0]} 👋`;
}

// --- KPI tiles ---------------------------------------------------------------

function renderKpis({ user, department, total }) {
  $('greeting').textContent = greeting(user.display_name);

  $('kpi-user-mb').textContent = formatSize(user.mb_migrated);
  $('kpi-user-mb-sub').textContent = `${user.files_migrated} ${user.files_migrated === 1 ? 'bestand' : 'bestanden'} naar SharePoint`;

  $('kpi-user-co2').textContent = formatCo2(user.co2_grams_saved_per_year);
  $('kpi-user-co2-sub').textContent = `per jaar · ${formatNumber(user.energy_kwh_saved_per_year, 3)} kWh`;

  $('kpi-dept-label').textContent = `CO₂ bespaard door ${department.name}`;
  $('kpi-dept-co2').textContent = formatCo2(department.co2_grams_saved_per_year);
  $('kpi-dept-co2-sub').textContent =
    `per jaar · ${department.user_count} ${department.user_count === 1 ? 'collega' : 'collega\'s'} · ${formatSize(department.mb_migrated)} verhuisd`;

  $('kpi-total-co2').textContent = formatCo2(total.co2_grams_saved_per_year);
  $('kpi-total-co2-sub').textContent = `per jaar · ${formatSize(total.mb_migrated)} verhuisd`;
}

// --- Amsterdam metaphors -----------------------------------------------------

/**
 * Positive reinforcement: translate the selected totals into the city.
 * Units adapt (minutes/hours/nights, metres/km) so small wins still feel real.
 */
function renderMetaphors() {
  const { data, scope } = state;
  const totals = data[scope];
  const container = $('metaphors');
  container.replaceChildren();

  if (totals.co2_grams_saved_per_year <= 0) {
    const who = { user: 'Je hebt', department: 'Je afdeling heeft', total: 'De gemeente heeft' }[scope];
    container.append(el('p', 'metaphor-empty',
      `${who} nog geen bestanden verhuisd. Zeg "Ja, verhuis het" in de widget en zie hier direct wat het oplevert. 🌱`));
    return;
  }

  const eq = totals.equivalents;
  const lantern = eq.streetlight_hours >= LANTERN_HOURS_PER_NIGHT
    ? `${formatNumber(eq.streetlight_nights, 1)} ${eq.streetlight_nights < 1.05 ? 'nacht' : 'nachten'}`
    : formatDuration(eq.streetlight_hours);

  const cards = [
    { icon: '🏮', value: lantern, text: 'licht voor een lantaarn langs de Keizersgracht, van zonsondergang tot zonsopgang' },
    { icon: '🌳', value: formatDuration(eq.tree_days * 24), text: 'zo lang doet een boom in het Vondelpark erover om deze CO₂ op te nemen' },
    { icon: '🚲', value: formatDistance(eq.car_km_avoided), text: 'autorijden vermeden. Die afstand fiets je voortaan gewoon' },
  ];

  for (const c of cards) {
    const card = el('article', 'metaphor');
    const body = el('div');
    body.append(el('p', 'metaphor-value', c.value), el('p', 'metaphor-text', c.text));
    card.append(el('span', 'metaphor-icon', c.icon), body);
    container.append(card);
  }
}

// --- Department chart + table -----------------------------------------------

const tooltip = $('tooltip');

/** Positions the tooltip near the pointer/element, kept inside the viewport. */
function showTooltip(target, dept, clientX, clientY) {
  tooltip.replaceChildren(
    el('strong', '', dept.name),
    el('div', '', `${formatCo2(dept.co2_grams_saved_per_year)} CO₂ per jaar`),
    el('div', '', `${dept.files_migrated} bestanden · ${formatSize(dept.mb_migrated)}`)
  );
  tooltip.hidden = false;
  const rect = target.getBoundingClientRect();
  const x = clientX ?? rect.left + rect.width / 2;
  const y = clientY ?? rect.top;
  const { offsetWidth: w, offsetHeight: h } = tooltip;
  tooltip.style.left = `${Math.min(Math.max(8, x + 12), window.innerWidth - w - 8)}px`;
  tooltip.style.top = `${Math.max(8, y - h - 10)}px`;
}
const hideTooltip = () => { tooltip.hidden = true; };

/**
 * Horizontal ranked bars: one series, the user's department highlighted.
 * Bars grow from a shared baseline; value labels sit at the bar tip.
 */
function renderChart(departments, ownDepartment) {
  const chart = $('dept-chart');
  const max = Math.max(...departments.map((d) => d.co2_grams_saved_per_year), 1);
  chart.replaceChildren();

  for (const dept of departments) {
    const row = el('div', `bar-row${dept.name === ownDepartment ? ' is-highlight' : ''}`);
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    row.setAttribute('aria-label',
      `${dept.name}: ${formatCo2(dept.co2_grams_saved_per_year)} CO₂ per jaar, ${dept.files_migrated} bestanden`);

    const track = el('div', 'bar-track');
    const bar = el('div', 'bar');
    bar.style.setProperty('--pct', String(dept.co2_grams_saved_per_year / max));
    track.append(bar, el('span', 'bar-value', formatCo2(dept.co2_grams_saved_per_year)));
    row.append(el('span', 'bar-label', dept.name), track);

    row.addEventListener('pointermove', (e) => showTooltip(row, dept, e.clientX, e.clientY));
    row.addEventListener('pointerleave', hideTooltip);
    row.addEventListener('focus', () => showTooltip(row, dept));
    row.addEventListener('blur', hideTooltip);
    chart.append(row);
  }

  // Accessible table view with the same data.
  $('dept-table').replaceChildren(...departments.map((d) => {
    const tr = el('tr');
    tr.append(
      el('td', '', d.name + (d.name === ownDepartment ? ' (jouw afdeling)' : '')),
      el('td', 'num', String(d.files_migrated)),
      el('td', 'num', formatNumber(d.mb_migrated, 1)),
      el('td', 'num', formatNumber(d.co2_grams_saved_per_year, 1))
    );
    return tr;
  }));
}

// --- Side panel ----------------------------------------------------------------

function renderSidePanel({ coaching, potential, recent_migrations: recent }) {
  $('choice-accepted').textContent = String(coaching.accepted);
  $('choice-declined').textContent = String(coaching.declined);

  const pot = $('potential');
  pot.replaceChildren();
  if (potential.files_remaining > 0) {
    pot.append(
      el('p', '', `Nog te winnen: ${formatCo2(potential.co2_grams_per_year)} CO₂ per jaar met ${potential.files_remaining} gedeelde ${potential.files_remaining === 1 ? 'bestand' : 'bestanden'} in je OneDrive.`)
    );
    const link = el('a', '', 'Bekijk suggesties in de widget →');
    link.href = 'index.html';
    pot.append(link);
  } else {
    pot.append(el('p', '', 'Al je intensief gedeelde bestanden staan op SharePoint. Top! 🌿'));
  }

  const list = $('recent');
  list.replaceChildren();
  if (recent.length === 0) {
    list.append(el('li', 'muted', 'Nog niets verhuisd.'));
    return;
  }
  for (const m of recent) {
    const li = el('li');
    const name = el('span', 'recent-name');
    name.append(el('span', 'recent-check', '✓'), m.filename);
    li.append(name, el('span', 'recent-meta', `${formatCo2(m.co2_grams_saved_per_year)} · ${formatDate(m.migrated_at)}`));
    list.append(li);
  }
}

// --- Methodology tab -----------------------------------------------------------

/** Dutch labels for the coefficients the API reports. */
const FACTOR_LABELS = {
  STORAGE_KWH_PER_GB_YEAR: ['Opslag', 'kWh per GB per jaar', 'Energie voor 24/7 opslag incl. koeling'],
  GRID_EMISSION_FACTOR_G_PER_KWH: ['Emissiefactor stroom', 'g CO₂ per kWh', 'Afgeronde waarde voor de Nederlandse stroommix'],
  NETWORK_KWH_PER_GB: ['Netwerk', 'kWh per GB', 'Energie om 1 GB over het netwerk te versturen'],
  SYNC_CYCLES_PER_YEAR: ['Sync-cycli', 'per collega per jaar', 'Volledige synchronisatie ongeveer 1× per week'],
  SHAREPOINT_SYNC_REDUCTION: ['SharePoint delta-sync', 'minder verkeer', 'Besparing op sync-verkeer na verhuizing'],
  ONEDRIVE_DUPLICATE_COPY_RATIO: ['Extra kopieën', 'per collega', 'Deel collega\'s dat een eigen kopie bewaart bij OneDrive-delen'],
};

function renderMethodology(methodology) {
  const rows = Object.entries(FACTOR_LABELS).map(([key, [label, unit, note]]) => {
    const raw = methodology.co2_factors[key];
    const value = key === 'SHAREPOINT_SYNC_REDUCTION' ? `${raw * 100}%` : formatNumber(raw, 3);
    const tr = el('tr');
    tr.append(el('td', '', label), el('td', 'num', `${value} ${key === 'SHAREPOINT_SYNC_REDUCTION' ? '' : unit}`.trim()), el('td', '', note));
    return tr;
  });
  $('factor-table').replaceChildren(...rows);
}

// --- Data loading ----------------------------------------------------------------

async function load() {
  try {
    const data = await api.co2Saved(state.userId);
    state.data = data;
    $('load-error').hidden = true;
    renderKpis(data);
    renderMetaphors();
    renderChart(data.departments, data.department.name);
    renderSidePanel(data);
    renderMethodology(data.methodology);
  } catch (err) {
    $('load-error').textContent = err.message;
    $('load-error').hidden = false;
  }
}

// --- Interactions ------------------------------------------------------------------

/** Accessible tabs: click + arrow keys. */
function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    for (const t of tabs) {
      const active = t === tab;
      t.setAttribute('aria-selected', String(active));
      t.tabIndex = active ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !active;
    }
    tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') select(tabs[(i + 1) % tabs.length]);
      if (e.key === 'ArrowLeft') select(tabs[(i - 1 + tabs.length) % tabs.length]);
    });
  });
}

function setupScopeSwitch() {
  const buttons = document.querySelectorAll('[data-scope]');
  buttons.forEach((btn) => btn.addEventListener('click', () => {
    state.scope = btn.dataset.scope;
    buttons.forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    if (state.data) renderMetaphors();
  }));
}

function setupTableToggle() {
  const btn = $('toggle-table');
  btn.addEventListener('click', () => {
    const showTable = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(showTable));
    btn.textContent = showTable ? 'Grafiek' : 'Tabel';
    $('dept-chart').hidden = showTable;
    $('dept-table-wrap').hidden = !showTable;
    document.querySelector('.chart-key').hidden = showTable;
  });
}

async function init() {
  setupTabs();
  setupScopeSwitch();
  setupTableToggle();

  try {
    await setupUserSelect($('user-select'), (userId) => { state.userId = userId; load(); });
    state.userId = $('user-select').value;
  } catch (err) {
    $('load-error').textContent = err.message;
    $('load-error').hidden = false;
    return;
  }

  await load();

  updates?.addEventListener('message', load);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
}

init();
