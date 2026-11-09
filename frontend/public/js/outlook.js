/**
 * @file outlook.js
 * @description Simulated Outlook compose window with a Groene Coach Smart Alert.
 *
 * Flow (mirrors an OnMessageSend event-based add-in in PromptUser mode):
 *   1. "Verzenden" -> POST /api/outlook/evaluate-send (sizes + recipient COUNT only)
 *   2. alert=false -> message is sent directly
 *      alert=true  -> Smart Alert dialog: "Deel als link" | "Toch verzenden" | "Terug naar bericht"
 *   3. Choice -> POST /api/outlook/resolve (aggregated telemetry only)
 * The user can ALWAYS send anyway: the coach informs, it never blocks.
 */

import { api, setupUserSelect, currentUser, updates } from './api.js';
import { el, append, button, toast } from './dom.js';
import { formatSize } from './format.js';

const $ = (id) => document.getElementById(id);
const MAX_CLONE_ICONS = 60;

const state = { files: [] };

const recipientCount = () => Math.min(500, Math.max(1, Number.parseInt($('recipients').value, 10) || 1));
const selectedFile = () => state.files.find((f) => String(f.id) === $('attachment').value);

/** Live visual of the Rick van Kersbergen rule: one tile per stored copy. */
function renderClones() {
  const n = recipientCount();
  const file = selectedFile();
  $('recipient-chip').textContent = n === 1 ? '1 ontvanger' : `${n} ontvangers`;
  const tiles = [el('span', 'clone is-original')];
  for (let i = 0; i < Math.min(n, MAX_CLONE_ICONS); i += 1) tiles.push(el('span', 'clone'));
  $('clones').replaceChildren(...tiles);
  $('clone-caption').textContent = file
    ? `Groen = het originele bestand. Blauw = ${n} kopieën in mailboxen${n > MAX_CLONE_ICONS ? ` (eerste ${MAX_CLONE_ICONS} getoond)` : ''}: samen ${formatSize(file.size_mb * n)}.`
    : '';
}

/** Shows what happened after sending. */
function renderResult(decision, resolved) {
  const result = $('result');
  result.className = `result${decision === 'share_link' ? '' : ' is-attachment'}`;
  if (decision === 'share_link') {
    const list = el('ul');
    for (const link of resolved.sharing_links) {
      const a = el('a', '', link.url);
      a.href = '#';
      a.addEventListener('click', (e) => e.preventDefault()); // fictional link
      list.append(append(el('li'), el('span', '', `${link.filename}: `), a));
    }
    result.replaceChildren(
      el('p', 'result-title', '✓ Verzonden met een link in plaats van een bijlage'),
      el('p', 'muted', `Dat voorkomt ${formatSize(resolved.storage_avoided_mb)} aan kopieën in mailboxen. Iedereen werkt nu in dezelfde versie.`),
      list);
  } else {
    result.replaceChildren(
      el('p', 'result-title', 'Verzonden met bijlage'),
      el('p', 'muted', 'Helemaal goed: jij bepaalt hoe je mailt. De coach onthoudt geen persoonlijke keuze, alleen een geanonimiseerde teller per afdeling.'));
  }
  result.hidden = false;
}

/** Opens the Smart Alert and resolves with the chosen option id. */
function askSmartAlert(evaluation) {
  const dialog = $('smart-alert');
  $('sa-message').textContent = evaluation.message;
  $('sa-transfer').textContent = `Eenmalig versturen van alle kopieën kost daarnaast ${evaluation.one_off_transfer.co2.label} aan netwerkenergie.`;
  return new Promise((resolve) => {
    const finish = (id) => { dialog.close(); resolve(id); };
    $('sa-actions').replaceChildren(...evaluation.options.map((opt, i) =>
      button(opt.label, i === 0 ? 'btn btn-primary' : 'btn btn-secondary', () => finish(opt.id))));
    dialog.addEventListener('cancel', () => resolve('cancel'), { once: true }); // Esc = back to message
    dialog.showModal();
  });
}

async function onSend(e) {
  e.preventDefault();
  const file = selectedFile();
  if (!file) { toast('Kies een bijlage om de Smart Alert te testen.'); return; }
  const n = recipientCount();
  $('send').disabled = true;
  $('send-status').textContent = 'Groene Coach controleert het bericht…';
  $('result').hidden = true;

  try {
    const evaluation = await api.evaluateSend([file.id], n);
    let decision = 'send_anyway';
    if (evaluation.alert) decision = await askSmartAlert(evaluation);

    if (decision === 'cancel') {
      $('send-status').textContent = 'Niet verzonden. Je kunt het bericht nog aanpassen.';
    } else {
      const resolved = evaluation.alert
        ? await api.resolveSend(decision, [file.id], n)
        : { sharing_links: [], storage_avoided_mb: 0 };
      renderResult(evaluation.alert ? decision : 'plain', resolved);
      $('send-status').textContent = evaluation.alert ? '' : 'Verzonden (geen melding nodig: weinig ontvangers of een kleine bijlage).';
      if (evaluation.alert) updates?.postMessage({ type: 'changed' });
    }
  } catch (err) {
    $('send-status').textContent = '';
    toast(err.message);
  } finally {
    $('send').disabled = false;
  }
}

/** Reload the attachment picker after (re)sign-in. */
async function onSignedIn(user) {
  $('load-error').hidden = true;
  $('from').textContent = `${user.display_name} · ${user.department}`;
  $('result').hidden = true;
  try {
    const { files } = await api.myFiles();
    state.files = [...files].sort((a, b) => b.size_mb - a.size_mb);
    $('attachment').replaceChildren(...state.files.map((f) =>
      new Option(`📎 ${f.filename} (${formatSize(f.size_mb)} · ${f.current_location})`, f.id)));
  } catch (err) {
    state.files = [];
    $('attachment').replaceChildren();
    $('load-error').textContent = err.message;
    $('load-error').hidden = false;
  }
  renderClones();
}

async function init() {
  $('compose').addEventListener('submit', onSend);
  $('recipients').addEventListener('input', renderClones);
  $('attachment').addEventListener('change', renderClones);
  document.querySelectorAll('[data-recipients]').forEach((b) => b.addEventListener('click', () => {
    $('recipients').value = b.dataset.recipients;
    renderClones();
  }));
  try {
    await setupUserSelect($('user-select'), onSignedIn);
  } catch (err) {
    $('load-error').textContent = err.message;
    $('load-error').hidden = false;
  }
  if (!currentUser()) renderClones();
}

init();

