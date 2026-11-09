/**
 * @file dom.js
 * @description Tiny DOM helpers. All dynamic text goes through textContent, so
 * data from the API (file names!) can never inject markup (XSS-safe by design).
 * The only innerHTML use is for constant, hard-coded SVG icons below.
 */

/** Creates an element with optional class and text. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** Appends children (skipping null/false) and returns the parent. */
export function append(parent, ...children) {
  for (const child of children) if (child) parent.append(child);
  return parent;
}

/** Creates a button. */
export function button(label, className = 'btn btn-secondary', onClick) {
  const b = el('button', className, label);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

// --- Icons (constant markup only) ---------------------------------------------------------
const SVG = {
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ic-folder" d="M2.5 6.5a2 2 0 0 1 2-2h4.6l2 2h8.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"/></svg>',
  shortcut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ic-shortcut" d="M2.5 6.5a2 2 0 0 1 2-2h4.6l2 2h8.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"/><rect class="ic-badge" x="11" y="11" width="10" height="10" rx="2"/><path class="ic-arrow" d="M14 18.5c0-2.5 1.5-4 4-4m0 0-1.6-1.4m1.6 1.4-1.6 1.4"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="ic-cloud" d="M7 18.5h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.2 9.6 4.5 4.5 0 0 0 7 18.5z"/></svg>',
};

/** Icon element: 'folder' | 'shortcut' | 'cloud'. */
export function icon(name) {
  const span = el('span', `ic ic--${name}`);
  span.innerHTML = SVG[name]; // constant markup, never data
  return span;
}

/** Coloured file-type tile, e.g. "W" for Word. */
export function fileIcon(filename) {
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  const map = { docx: ['W', 'word'], xlsx: ['X', 'excel'], pptx: ['P', 'ppt'], pdf: ['PDF', 'pdf'], zip: ['ZIP', 'zip'],
    mp4: ['▶', 'video'], csv: ['CSV', 'excel'], vsdx: ['V', 'word'] };
  const [label, kind] = map[ext] ?? ['•', 'other'];
  return el('span', `file-ic file-ic--${kind}`, label);
}

let toastTimer;
/**
 * Shows a status message, optionally with one action button (e.g. "Ongedaan maken").
 * @param {string} message
 * @param {{ actionLabel?: string, onAction?: () => void, ms?: number }} [options]
 */
export function toast(message, { actionLabel, onAction, ms = 6000 } = {}) {
  const node = document.getElementById('toast');
  node.replaceChildren(el('span', '', message));
  if (actionLabel) {
    node.append(button(actionLabel, 'toast-action', () => { node.hidden = true; onAction(); }));
  }
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}
