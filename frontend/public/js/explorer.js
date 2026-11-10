/**
 * @file explorer.js
 * @description The "Bestanden" tab: a small shell with three parts (sub-tabs).
 *
 *   Verhuizen             moveBoard.js   ready list, "Eerst nakijken", optional "Zelf slepen"
 *   Dubbele kopieën       duplicates.js
 *   Mijn SharePoint-sites sites.js
 *
 * ("Voor en na" is a demo page for the product owner now, in the Demo menu.)
 *
 * The Actie-hub opens the Bestanden tab on a specific part via `select()`, e.g.
 * { view: 'move', filter: 'old' } scrolls to the files that need checking first.
 */

import { createMoveBoard } from './moveBoard.js';
import { createDuplicates } from './duplicates.js';
import { createSites } from './sites.js';

/** @param {object} ctx shared app context (see app.js) */
export function createExplorer(ctx) {
  const parts = {
    move: createMoveBoard(ctx),
    duplicates: createDuplicates(ctx),
    sites: createSites(ctx),
  };
  const subtabs = [...document.querySelectorAll('#tab-explorer [role="tab"]')];
  /** Filter requested by the Actie-hub, applied once the data is there. */
  let pendingFilter = null;

  /** Shows one part and marks its sub-tab as selected (accessible tabs pattern). */
  function showView(view, { focus = false } = {}) {
    for (const tab of subtabs) {
      const active = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
      if (active && focus) tab.focus();
    }
  }

  // Click + arrow keys, like the main tabs.
  subtabs.forEach((tab, i) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step) showView(subtabs[(i + step + subtabs.length) % subtabs.length].dataset.view, { focus: true });
    });
  });

  return {
    /** Open a specific part (and filter); called by the Actie-hub buttons. */
    select({ view = 'move', filter = null } = {}) {
      showView(view);
      pendingFilter = filter;
      if (view === 'move') parts.move.applyFilter(filter); // works right away if already loaded
    },

    /** Loads all parts in parallel; the shell reloads them after every change. */
    async load() {
      await Promise.all(Object.values(parts).map((part) => part.load()));
      if (pendingFilter) {
        parts.move.applyFilter(pendingFilter);
        pendingFilter = null;
      }
    },
  };
}
