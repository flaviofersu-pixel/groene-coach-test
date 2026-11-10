/**
 * @file explorer.js
 * @description The "Verkenner" tab: a small shell with four parts (sub-tabs).
 *
 *   Verhuizen             moveBoard.js   ready list + drag OneDrive -> SharePoint
 *   Dubbele kopieën       duplicates.js
 *   Mijn SharePoint-sites sites.js
 *   Voor en na            preview.js     before/after preview in Windows Explorer
 *
 * The Actie-hub opens the Verkenner on a specific part via `select()`, e.g.
 * { view: 'move', filter: 'old' } shows the OneDrive column filtered on old files.
 */

import { createMoveBoard } from './moveBoard.js';
import { createDuplicates } from './duplicates.js';
import { createSites } from './sites.js';
import { createPreview } from './preview.js';

/** @param {object} ctx shared app context (see app.js) */
export function createExplorer(ctx) {
  const parts = {
    move: createMoveBoard(ctx),
    duplicates: createDuplicates(ctx),
    sites: createSites(ctx),
    preview: createPreview(ctx),
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

    /** Loads all four parts in parallel; the shell reloads them after every change. */
    async load() {
      await Promise.all(Object.values(parts).map((part) => part.load()));
      if (pendingFilter) {
        parts.move.applyFilter(pendingFilter);
        pendingFilter = null;
      }
    },
  };
}
