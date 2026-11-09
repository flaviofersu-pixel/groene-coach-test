/**
 * @file app.js
 * @description Shell of the Teams app: sign-in, tabs and view lifecycle.
 *
 * PATTERN: each tab is a small "view module" with a `load()` method. The shell
 * loads the visible tab and marks the others stale; a stale tab reloads when
 * it is opened. A shared context object lets views talk to the shell (e.g. the
 * Actie-hub switching to the Verkenner after "Toon map in Verkenner").
 */

import { api, setupUserSelect, updates } from './api.js';
import { createActionHub } from './actionHub.js';
import { createExplorer } from './explorer.js';
import { createImpact } from './impact.js';
import { createAbout } from './about.js';

const $ = (id) => document.getElementById(id);

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

/** Accessible tabs (click + arrow keys). */
function showTab(id, { focus = false } = {}) {
  activeTab = id;
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const active = tab.getAttribute('aria-controls') === id;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
    if (active && focus) tab.focus();
  }
  return loadActive();
}

function setupTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => showTab(tab.getAttribute('aria-controls')));
    tab.addEventListener('keydown', (e) => {
      const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
      if (next) showTab(next.getAttribute('aria-controls'), { focus: true });
    });
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
}

async function init() {
  setupTabs();
  // Another window changed something: refresh (ignored until signed in).
  updates?.addEventListener('message', () => { if (ctx.me) ctx.refreshAll({ broadcast: false }).catch(() => {}); });
  try {
    await setupUserSelect($('user-select'), onSignedIn);
  } catch (err) {
    ctx.showError(err.message);
  }
}

init();
