/**
 * @file about.js
 * @description The "Privacy & berekening" tab: which Graph permissions the
 * app holds (from the token), and the live co2_metrics coefficient table.
 */

import { api } from './api.js';
import { el, append } from './dom.js';
import { formatNumber } from './format.js';

const $ = (id) => document.getElementById(id);

/** Why each delegated Graph scope is needed. */
const SCOPES = [
  ['User.Read', 'Je naam, voor de begroeting.'],
  ['Files.Read.All', 'Je OneDrive bekijken: of bestanden gedeeld zijn en welke kopieën identiek zijn.'],
  ['Files.ReadWrite.All', 'Bestanden verplaatsen naar SharePoint, snelkoppelingen toevoegen en kopieën naar de prullenbak zetten, alleen na jouw klik. Vereist admin consent.'],
  ['Sites.Read.All', 'De teamsites tonen waarvan je lid bent, met hun mappen.'],
];

/** @param {object} ctx shared app context (see app.js) */
export function createAbout(ctx) {
  return {
    async load() {
      $('scope-list').replaceChildren(...SCOPES.map(([scope, why]) => {
        const granted = ctx.me.scopes.includes(scope);
        return append(el('li'),
          el('span', `scope-status ${granted ? 'scope-ok' : 'scope-missing'}`, granted ? '✓' : '✗'),
          append(el('div'), append(el('div'), el('code', '', scope)), el('div', 'muted', why)));
      }));

      const { metrics } = await api.metrics();
      $('metrics-table').replaceChildren(...metrics.map((m) => append(el('tr'),
        el('td', '', m.label),
        el('td', 'num', formatNumber(m.value_low, 3)),
        el('td', 'num', formatNumber(m.value_high, 3)),
        el('td', '', m.unit),
        el('td', 'small', m.derivation))));
    },
  };
}
