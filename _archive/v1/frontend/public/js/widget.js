/**
 * @file widget.js
 * @description The desktop coaching widget.
 *
 * Flow (see the brief):
 *  1. Trigger:  on startup, GET /api/files/scan-onedrive for the signed-in user.
 *  2. Persona:  show ONE friendly Dutch suggestion card at a time (never a stack).
 *  3. Autonomy: "Ja, verhuis het" -> POST migrate -> green checkmark.
 *               "Nu niet"         -> POST decline (logged), card closes gently.
 *               "–"               -> minimise to the tray, decide later.
 *
 * Non-intrusive by design: the card never steals keyboard focus, appears after
 * a short delay, can be minimised at any time, and a declined file is not
 * suggested again during the snooze window (enforced by the backend).
 */

import { api, getCurrentUserId, setupUserSelect, updates } from './api.js';
import { formatCo2, formatSize, formatDaysAgo, formatDate } from './format.js';

/** Delay before the first card appears, so it feels like a background trigger. */
const STARTUP_DELAY_MS = 900;
/** How long the green confirmation stays visible before the next suggestion. */
const CONFIRMATION_MS = 2600;

const els = {
  coach: document.getElementById('coach'),
  template: document.getElementById('tpl-suggestion'),
  trayButton: document.getElementById('tray-button'),
  trayBadge: document.getElementById('tray-badge'),
  toast: document.getElementById('toast'),
  userSelect: document.getElementById('user-select'),
  rescan: document.getElementById('rescan'),
  clock: document.getElementById('clock'),
};

/** Widget state: the queue of suggestions for the current user. */
const state = {
  userId: getCurrentUserId(),
  queue: [],
  index: 0,
  busy: false,
};

// --- Small UI helpers --------------------------------------------------------

let toastTimer;
/** Shows a short, self-dismissing status message. */
function showToast(message, ms = 4500) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}

/** Number of open suggestions on the tray icon. */
function updateBadge() {
  const remaining = state.queue.length - state.index;
  els.trayBadge.hidden = remaining <= 0;
  els.trayBadge.textContent = String(remaining);
  els.trayButton.title = remaining > 0 ? `Klimaattool: ${remaining} suggestie(s)` : 'Klimaattool: alles staat op de juiste plek';
}

/** File-type label for the icon tile, e.g. "XLSX". */
const extensionOf = (filename) => (filename.includes('.') ? filename.split('.').pop().toUpperCase().slice(0, 4) : 'FILE');

/** Hides the current card, with a short exit animation. */
function hideCard() {
  const card = els.coach.querySelector('.card');
  if (!card) { els.coach.hidden = true; return Promise.resolve(); }
  card.classList.add('is-leaving');
  return new Promise((resolve) => {
    setTimeout(() => { els.coach.hidden = true; els.coach.replaceChildren(); resolve(); }, 200);
  });
}

// --- Rendering ---------------------------------------------------------------

/**
 * Builds a suggestion card from the <template>. Only textContent is used, so
 * file names from the database can never inject HTML.
 * @param {object} file Item from /api/files/scan-onedrive
 */
function renderCard(file) {
  const card = els.template.content.firstElementChild.cloneNode(true);
  const field = (name) => card.querySelector(`[data-field="${name}"]`);
  const savings = file.projected_savings;

  field('counter').textContent = `${state.index + 1} van ${state.queue.length}`;
  field('ext').textContent = extensionOf(file.filename);
  field('filename').textContent = file.filename;

  const meta = [
    `Gedeeld met ${file.share_count} collega's`,
    formatSize(file.file_size_mb),
    `laatst geopend ${formatDaysAgo(file.days_since_access)}`,
  ];
  if (file.is_stale) meta.push('al lang niet gebruikt');
  field('meta').textContent = meta.join(' · ');

  // "Geschatte besparing: <strong>14,9 g CO2</strong> per jaar (-40 %)"
  const saving = field('saving');
  saving.append('Geschatte besparing: ');
  const strong = document.createElement('strong');
  strong.textContent = `${formatCo2(savings.co2_grams_per_year)} CO₂`;
  saving.append(strong, ` per jaar (−${Math.round(savings.reduction_percent)}%)`);

  card.querySelector('[data-action="accept"]').addEventListener('click', () => accept(card, file));
  card.querySelector('[data-action="decline"]').addEventListener('click', () => decline(card, file));
  card.querySelector('[data-action="minimize"]').addEventListener('click', minimize);
  return card;
}

/** Shows the suggestion at state.index (or closes the widget when done). */
function showCurrent() {
  updateBadge();
  const file = state.queue[state.index];
  if (!file) { hideCard(); return; }
  els.coach.replaceChildren(renderCard(file));
  els.coach.hidden = false;
  // Intentionally NO focus() call: the user keeps working undisturbed.
}

/** Moves on to the next suggestion after an optional pause. */
async function next(delayMs = 0) {
  state.index += 1;
  updateBadge();
  await hideCard();
  if (state.index < state.queue.length) {
    setTimeout(showCurrent, delayMs);
  } else if (state.queue.length > 0) {
    showToast('Alle suggesties zijn bekeken. Bedankt voor het meedenken! 🌿');
  }
}

// --- User actions ------------------------------------------------------------

/** Enables/disables the card buttons while a request is running. */
function setBusy(card, busy) {
  state.busy = busy;
  card.querySelectorAll('.actions .btn').forEach((b) => { b.disabled = busy; });
}

/** "Ja, verhuis het": migrate, then show the green checkmark. */
async function accept(card, file) {
  if (state.busy) return;
  const errorEl = card.querySelector('[data-field="error"]');
  errorEl.hidden = true;
  setBusy(card, true);
  card.querySelector('[data-action="accept"]').textContent = 'Bezig met verhuizen…';

  try {
    const result = await api.migrate(file.id, state.userId);
    card.dataset.state = 'done';
    card.querySelector('[data-field="done-text"]').textContent =
      `${file.filename} staat nu op de juiste plek voor je collega's. ` +
      `Dat scheelt ongeveer ${formatCo2(result.savings.co2_grams_per_year)} CO₂ per jaar.`;
    updates?.postMessage({ type: 'migrated', fileId: file.id, userId: state.userId });
    setBusy(card, false);
    setTimeout(() => next(400), CONFIRMATION_MS);
  } catch (err) {
    errorEl.textContent = `${err.message} Probeer het later nog eens.`;
    errorEl.hidden = false;
    card.querySelector('[data-action="accept"]').textContent = 'Opnieuw proberen';
    setBusy(card, false);
  }
}

/**
 * "Nu niet": the user's choice is honoured IMMEDIATELY. The card closes even
 * if logging the decision fails, because control must stay with the user.
 */
async function decline(card, file) {
  if (state.busy) return;
  setBusy(card, true);
  let until = null;
  try {
    const result = await api.decline(file.id, state.userId);
    until = result.snoozed_until;
  } catch (err) {
    console.warn('[widget] Could not log "Nu niet":', err.message);
  }
  state.busy = false;
  showToast(
    `Helemaal goed, ${file.filename} blijft in je OneDrive.` +
      (until ? ` We vragen het niet opnieuw vóór ${formatDate(until)}.` : '')
  );
  next(1200);
}

/** "–": tuck the card away; the tray badge keeps the suggestion available. */
function minimize() {
  hideCard();
  updateBadge();
}

/** Tray icon: re-open the current suggestion, or reassure that all is well. */
function onTrayClick() {
  if (!els.coach.hidden) { minimize(); return; }
  if (state.index < state.queue.length) showCurrent();
  else showToast('Geen nieuwe suggesties. Je gedeelde bestanden staan op de juiste plek. 🌿');
}

// --- Trigger -----------------------------------------------------------------

/** Step 1 of the brief: scan OneDrive and queue heavily shared files. */
async function scan({ delayMs = STARTUP_DELAY_MS } = {}) {
  await hideCard();
  try {
    const result = await api.scanOneDrive(state.userId);
    state.queue = result.files;
    state.index = 0;
    updateBadge();
    if (state.queue.length > 0) setTimeout(showCurrent, delayMs);
  } catch (err) {
    state.queue = [];
    updateBadge();
    showToast(err.message, 6000);
  }
}

function tickClock() {
  els.clock.textContent = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

async function init() {
  tickClock();
  setInterval(tickClock, 15_000);

  els.trayButton.addEventListener('click', onTrayClick);
  els.rescan.addEventListener('click', () => scan({ delayMs: 200 }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.coach.hidden) minimize(); });

  try {
    await setupUserSelect(els.userSelect, (userId) => {
      state.userId = userId;
      scan({ delayMs: 300 });
    });
    state.userId = els.userSelect.value;
  } catch (err) {
    showToast(err.message, 6000);
    return;
  }
  scan();
}

init();
