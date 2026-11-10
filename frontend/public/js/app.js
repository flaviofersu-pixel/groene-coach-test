/**
 * @file app.js
 * @description Shell of the Teams app: sign-in, tabs and view lifecycle.
 *
 * PATTERN: each tab is a small "view module" with a `load()` method. The shell
 * loads the visible tab and marks the others stale; a stale tab reloads when
 * it is opened. A shared context object lets views talk to the shell (e.g. an
 * Actie-hub button opening the Bestanden tab on the right part).
 */

import { api, setupUserSelect, updates } from './api.js';
import { createActionHub } from './actionHub.js';
import { createExplorer } from './explorer.js';
import { createImpact } from './impact.js';
import { createAbout } from './about.js';
import { createPreview } from './preview.js';
import { loadCo2Factors } from './co2.js';

const $ = (id) => document.getElementById(id);

/** The main tabs only (the Bestanden tab has its own sub-tabs, handled in explorer.js). */
const mainTabs = () => [...document.querySelectorAll('.tabs [role="tab"]')];

/** Shared context handed to every view. */
const ctx = {
  /** Result of GET /api/user/me (profile, scopes, sites). */
  me: null,
  showTab,
  /** Reload profile + mark every view stale (after a change). */
  async refreshAll({ broadcast = true } = {}) {
    ctx.me = await api.me();
    for (const view of Object.values(views)) view.stale = true;
    await loadActive();
    if (broadcast) updates?.postMessage({ type: 'changed' });
  },
  showError(message) {
    $('load-error').textContent = message;
    $('load-error').hidden = !message;
  },
};

const views = {
  'tab-hub': createActionHub(ctx),
  'tab-explorer': createExplorer(ctx),
  'tab-impact': createImpact(ctx),
  'tab-about': createAbout(ctx),
  'tab-preview': createPreview(ctx), // demo page "Voor en na", opened from the Demo menu
};
for (const view of Object.values(views)) view.stale = true;

let activeTab = 'tab-hub';

async function loadView(id) {
  const view = views[id];
  if (!view.stale || !ctx.me) return;
  view.stale = false;
  try {
    ctx.showError('');
    await view.load();
  } catch (err) {
    view.stale = true;
    ctx.showError(err.message);
  }
}
const loadActive = () => loadView(activeTab);

/**
 * Shows one page. Actie-hub, Bestanden and Impact are tabs at the top;
 * Privacy & berekening (footer) and Voor en na (Demo menu) are pages without a tab button.
 * @param {string} id panel id, e.g. 'tab-explorer'
 * @param {{ focus?: boolean, focusHeading?: boolean, view?: string, filter?: string }} [options]
 *   focus        move keyboard focus to the tab button (arrow-key navigation)
 *   focusHeading move focus to the page heading (footer / back links), and scroll to the top
 *   view/filter  open a specific part of that page (used by the Actie-hub buttons)
 */
function showTab(id, { focus = false, focusHeading = false, view, filter } = {}) {
  activeTab = id;
  if (view) views[id].select?.({ view, filter });

  for (const panel of document.querySelectorAll('.tab-panel')) panel.hidden = panel.id !== id;

  // Tabs: the matching one is selected. On a footer page no tab is selected,
  // but the first tab stays reachable with the Tab key.
  const tabs = mainTabs();
  const activeTabButton = tabs.find((tab) => tab.getAttribute('aria-controls') === id);
  for (const tab of tabs) {
    const active = tab === activeTabButton;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active || (!activeTabButton && tab === tabs[0]) ? 0 : -1;
    if (active && focus) tab.focus();
  }

  // Footer links say which page is open.
  for (const link of document.querySelectorAll('.footer-link')) {
    if (link.dataset.open === id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  if (focusHeading) {
    window.scrollTo({ top: 0 });
    $(id).querySelector('.page-title, h2')?.focus({ preventScroll: true });
  }
  return loadActive();
}

/** Every element with data-open="<panel id>" (footer, back links, "Bekijk alle impact") opens that page. */
function setupPageLinks() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-open]');
    if (!link) return;
    $('demo-menu').open = false; // a choice in the Demo menu closes it
    showTab(link.dataset.open, { focusHeading: true });
  });
}

function setupTabs() {
  const tabs = mainTabs();
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => showTab(tab.getAttribute('aria-controls')));
    tab.addEventListener('keydown', (e) => {
      const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
      if (next) showTab(next.getAttribute('aria-controls'), { focus: true });
    });
  });
}

/** The demo menu closes on a click outside it or on Esc, like a normal menu. */
function setupDemoMenu() {
  const menu = $('demo-menu');
  document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
}

/** Called after every simulated SSO sign-in (start and user switch). */
async function onSignedIn() {
  try {
    await ctx.refreshAll({ broadcast: false });
  } catch (err) {
    ctx.showError(err.message);
    return;
  }
  $('consent-banner').hidden = ctx.me.admin_consent_granted;
  $('demo-user').textContent = ctx.me.user.display_name;
  $('demo-menu').open = false;
}

async function init() {
  setupTabs();
  setupPageLinks();
  setupDemoMenu();
  await loadCo2Factors(); // numbers for the CO2 info popovers
  // Another window changed something: refresh (ignored until signed in).
  updates?.addEventListener('message', () => { if (ctx.me) ctx.refreshAll({ broadcast: false }).catch(() => {}); });
  try {
    await setupUserSelect($('user-select'), onSignedIn);
  } catch (err) {
    ctx.showError(err.message);
  }
}

init();
