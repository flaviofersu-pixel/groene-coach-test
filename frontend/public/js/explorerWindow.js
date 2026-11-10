/**
 * @file explorerWindow.js
 * @description A file panel: an address bar ("› OneDrive - Gemeente Amsterdam")
 * and a folder tree. Used by the drag-and-drop board and by the before/after
 * preview, so both look the same. Deliberately NO fake title bar or
 * minimise/maximise/close buttons: they would look clickable but do nothing.
 */

import { el, append, icon } from './dom.js';

/**
 * Fills `container` with an Explorer window around a tree.
 * @param {HTMLElement} container
 * @param {string} address text in the address bar, e.g. "OneDrive - Gemeente Amsterdam"
 * @param {HTMLElement} tree a <ul class="tree"> element
 * @param {{ addressIcon?: string }} [options]
 */
export function renderExplorerWindow(container, address, tree, { addressIcon = 'cloud' } = {}) {
  container.replaceChildren(
    append(el('div', 'explorer-address'), icon(addressIcon), el('span', '', `› ${address}`)),
    append(el('div', 'explorer-tree'), tree));
}

/**
 * A folder node: <details> with a clickable row (native, keyboard accessible
 * open/close) and a list for its children.
 * @returns {{ li: HTMLLIElement, details: HTMLDetailsElement, row: HTMLElement, list: HTMLUListElement }}
 */
export function folderNode({ name, iconName = 'folder', count, open = false, extraClass = '' }) {
  const details = el('details', extraClass);
  details.open = open;
  const row = append(el('div', `tree-row${iconName === 'shortcut' ? ' is-shortcut' : ''}`), icon(iconName), el('span', 'tree-name', name));
  if (count !== undefined) row.append(el('span', 'small muted', `(${count})`));
  const list = el('ul');
  const li = append(el('li'), append(details, append(el('summary'), row), list));
  return { li, details, row, list };
}
