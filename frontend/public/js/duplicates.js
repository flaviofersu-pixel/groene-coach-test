/**
 * @file duplicates.js
 * @description Bestanden part "Dubbele kopieën": identical copies in the user's
 * own OneDrive (and the original on a team site, when there is one).
 *
 * Clean-up always needs an explicit confirmation, sends copies to the recycle
 * bin (restorable for 93 days) and can be undone. Colleagues' files are never
 * looked at or counted.
 */

import { api } from './api.js';
import { el, append, button, fileIcon, infoButton, toast } from './dom.js';
import { formatSize, lastEditedLabel, plural } from './format.js';
import { co2Amount, co2Text } from './co2.js';

const $ = (id) => document.getElementById(id);

/** How we recognise copies (behind the "i" next to the title). */
const DETECTION_INFO = () => [
  el('p', 'info-title', 'Hoe vinden we dubbele kopieën?'),
  el('p', '', 'Microsoft 365 houdt van elk bestand een soort vingerafdruk bij (een hash). ' +
    'Twee bestanden met dezelfde vingerafdruk zijn precies gelijk, ook als de naam anders is, zoals "Kopie van …".'),
  el('p', '', 'We lezen de inhoud van je bestanden niet. We kijken alleen in je eigen OneDrive en op teamsites waar je lid van bent.'),
];

/** @param {object} ctx shared app context (see app.js) */
export function createDuplicates(ctx) {
  const state = { chains: [] };

  function chainCard(ch) {
    const copies = el('ul', 'chain-copies');
    for (const c of ch.my_copies) copies.append(el('li', '', `${c.filename} (map ${c.folder}) · ${lastEditedLabel(c.last_modified)}`));

    const foot = el('div', 'chain-foot');
    if (ch.can_consolidate) {
      foot.append(
        append(el('span', 'small muted', `Jij kunt ${formatSize(ch.size_mb * ch.removable_count)} vrijmaken: `),
          co2Amount(ch.my_saving.co2_per_year, { info: false })),
        button('Ruim mijn kopieën op…', 'btn btn-secondary btn-sm', () => confirmConsolidate(ch)));
    } else {
      foot.append(el('span', 'small muted', 'Je hebt hier geen overbodige kopie. Tip: deel voortaan de link naar de teamsite.'));
    }

    return append(el('article', 'chain'),
      append(el('div', 'chain-head'), fileIcon(ch.filename), el('span', 'chain-name', ch.filename)),
      el('p', 'chain-meta', `${plural(ch.my_copies.length, 'kopie', 'kopieën')} in je OneDrive · ${formatSize(ch.size_mb)} per stuk`),
      el('p', 'chain-meta', ch.master
        ? `Origineel op de teamsite: ${ch.master.site} › ${ch.master.folder}`
        : 'Er staat nog geen versie op een teamsite.'),
      copies,
      foot);
  }

  function render() {
    const container = $('chain-list');
    container.replaceChildren(...state.chains.map(chainCard));
    if (state.chains.length === 0) container.append(el('p', 'empty', 'Geen dubbele kopieën gevonden in je OneDrive.'));
  }

  /** Explicit consent dialog before anything goes to the recycle bin. */
  function confirmConsolidate(chain) {
    const dialog = $('confirm-dialog');
    const removable = chain.master ? chain.my_copies : chain.my_copies.slice(1);
    $('confirm-body').replaceChildren(
      el('p', '', chain.master
        ? `Het origineel blijft bewaard op de teamsite ${chain.master.site}. Deze kopieën uit je OneDrive gaan naar je prullenbak:`
        : `"${chain.my_copies[0].filename}" wordt eerst verhuisd naar je teamsite, als de centrale versie. Deze kopieën gaan naar je prullenbak:`),
      append(el('ul'), ...removable.map((c) => el('li', '', `${c.filename} (map ${c.folder})`))),
      el('p', '', 'Je kunt ze 93 dagen lang terugzetten.'));

    const ok = $('confirm-ok');
    const cancel = $('confirm-cancel');
    const close = () => { dialog.close(); ok.onclick = null; cancel.onclick = null; };
    cancel.onclick = close;
    ok.onclick = async () => {
      close();
      try {
        const result = await api.consolidate(chain.content_hash);
        toast(`${plural(result.recycled.length, 'kopie', 'kopieën')} naar de prullenbak · ${co2Text(result.estimate.co2_per_year)} bespaard.`, {
          actionLabel: 'Ongedaan maken',
          ms: 10_000,
          onAction: async () => {
            for (const r of result.recycled) await api.restore(r.id);
            toast('Teruggezet. Er is niets verloren gegaan.');
            await ctx.refreshAll();
          },
        });
        await ctx.refreshAll();
      } catch (err) {
        toast(err.message);
      }
    };
    dialog.showModal();
  }

  $('chains-title').after(infoButton('Uitleg over dubbele kopieën', DETECTION_INFO));

  return {
    async load() {
      if (!ctx.me.admin_consent_granted) {
        state.chains = [];
        render();
        return;
      }
      state.chains = (await api.chains()).chains;
      render();
    },
  };
}
