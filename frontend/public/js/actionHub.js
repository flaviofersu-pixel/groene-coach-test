/**
 * @file actionHub.js
 * @description The "Actie-hub" tab: a short list of recommended actions,
 * comparable to "Energy recommendations" in Windows Settings.
 *
 * Every action has a short title, the estimated saving (or an honest note
 * when we cannot put a number on it) and one button.
 * Below the list, a small "Wat je acties opleveren" summary (you and your teams);
 * the full Impact page is linked from there and from the footer. The button opens the
 * Bestanden tab with the right part (and filter) already selected; the actual
 * work (moving, cleaning up) always happens there, after the user's click.
 */

import { api } from './api.js';
import { el, append, button, icon } from './dom.js';
import { formatSize, firstName, plural, greetingFor } from './format.js';
import { co2Amount, co2InfoButton } from './co2.js';

const $ = (id) => document.getElementById(id);

/**
 * How each action from the API is shown. `title` and `doneTitle` get the count;
 * `target` is where the button takes you in the Bestanden tab.
 */
const ACTION_TEXT = {
  move: {
    icon: 'move',
    title: (n) => `Verhuis ${plural(n, 'gedeeld bestand', 'gedeelde bestanden')} naar je teamsite`,
    doneTitle: 'Je gedeelde bestanden staan op de teamsite',
    target: { view: 'move', filter: 'ready' },
  },
  duplicates: {
    icon: 'copies',
    title: (n) => `Ruim ${plural(n, 'dubbele kopie', 'dubbele kopieën')} op`,
    doneTitle: 'Geen dubbele kopieën in je OneDrive',
    target: { view: 'duplicates' },
  },
  old: {
    icon: 'clock',
    title: (n) => `Bekijk ${plural(n, 'bestand dat', 'bestanden die')} al meer dan een jaar niet ${n === 1 ? 'is' : 'zijn'} bewerkt`,
    doneTitle: 'Geen bestanden die lang niet zijn bewerkt',
    target: { view: 'move', filter: 'old' },
  },
  shortcut: {
    icon: 'shortcut',
    title: (n) => `Voeg ${plural(n, 'snelkoppeling', 'snelkoppelingen')} naar je teamsites toe aan Mijn bestanden`,
    doneTitle: 'Je teamsites staan al in Mijn bestanden',
    target: { view: 'sites' },
  },
};

/** Second line of an action: the saving, or why there is no number. */
/**
 * @param {object} action
 * @param {boolean} isMainTotal the top action of the list: the only place on this
 *   screen that shows the everyday example
 */
function actionDetail(action, isMainTotal) {
  if (action.count === 0) return el('span', 'action-sub', 'Niets te doen');
  switch (action.id) {
    case 'move':
      return append(el('span', 'action-sub', 'Geschatte besparing: '), co2Amount(action.estimate.co2_per_year, { example: isMainTotal }));
    case 'duplicates':
      return append(el('span', 'action-sub', `${formatSize(action.storage_freed_mb)} vrij · Geschatte besparing: `),
        co2Amount(action.estimate.co2_per_year, { example: isMainTotal }));
    case 'old':
      return el('span', 'action-sub', 'Check eerst de bewaarregels: sommige documenten moet je bewaren');
    case 'shortcut':
      return el('span', 'action-sub', 'Geen directe besparing: je vindt je teambestanden sneller');
    default:
      return null;
  }
}

/**
 * Order: actions with the biggest (upper-bound) saving first, then actions
 * without a figure, and finished actions last.
 */
function sortActions(actions) {
  const rank = (a) => {
    if (a.count === 0) return -2;
    return a.estimate ? a.estimate.co2_per_year.high : -1;
  };
  return [...actions].sort((a, b) => rank(b) - rank(a));
}

/** @param {object} ctx shared app context (see app.js) */
export function createActionHub(ctx) {
  /** One row: icon, title + detail, and the button (or a "done" check). */
  function renderAction(action, isMainTotal) {
    const text = ACTION_TEXT[action.id];
    if (!text) return null;
    const done = action.count === 0;

    const titleId = `action-title-${action.id}`;
    const title = el('div', 'action-title', done ? text.doneTitle : text.title(action.count));
    title.id = titleId;

    let control;
    if (done) {
      control = el('span', 'pill pill--success', '✓ Klaar');
    } else {
      control = button('Bekijken', 'btn btn-secondary', () => ctx.showTab('tab-explorer', text.target));
      control.setAttribute('aria-describedby', titleId); // "Bekijken" + which action
    }

    return append(el('li', `action-row${done ? ' is-done' : ''}`),
      append(el('span', 'action-icon'), icon(text.icon)),
      append(el('div', 'action-main'), title, actionDetail(action, isMainTotal)),
      control);
  }

  /**
   * One small tile of the impact summary. Without a saving yet (nothing done, or
   * suppressed) it shows what you can do instead of "0 gram CO₂".
   */
  function impactTile(label, co2, sub, emptyText) {
    return append(el('article', 'hub-impact-tile'),
      el('h4', 'hub-impact-label', label),
      co2 ? co2Amount(co2) : el('p', 'hub-impact-empty', emptyText),
      co2 ? el('p', 'hub-impact-sub', sub) : null);
  }

  /** "Wat je acties opleveren": your own saving and your teams' saving. */
  function renderImpactSummary({ personal, my_teams: myTeams }) {
    const hasPersonal = personal.actions > 0 && personal.co2_per_year.high > 0;
    const hasTeams = !myTeams.suppressed && myTeams.migrations > 0;
    $('hub-impact').replaceChildren(
      impactTile('Jouw bijdrage (alleen voor jou)', hasPersonal ? personal.co2_per_year : null,
        plural(personal.actions, 'actie', 'acties'), 'Nog niets bespaard. Begin met een actie hierboven.'),
      impactTile('Jouw teams', hasTeams ? myTeams.co2_per_year : null,
        `${plural(myTeams.migrations, 'document', 'documenten')} naar de teamsite verhuisd`,
        myTeams.suppressed ? myTeams.reason : 'Nog geen documenten naar je teamsites verhuisd.'));
  }

  function renderActions(actions) {
    const sorted = sortActions(actions);
    // The everyday example appears once on this screen: on the top action with a saving.
    const main = sorted.find((a) => a.count > 0 && a.estimate);
    $('action-list').replaceChildren(...sorted.map((a) => renderAction(a, a === main)).filter(Boolean));
  }

  // One explanation per card: next to the card titles.
  $('actions-title').after(co2InfoButton());
  $('hub-impact-title').after(co2InfoButton());

  return {
    async load() {
      $('hub-greeting').textContent = `${greetingFor(new Date())}, ${firstName(ctx.me.user.display_name)}`;
      if (!ctx.me.admin_consent_granted) {
        $('action-list').replaceChildren(el('li', 'empty', 'Er zijn nog geen acties: OpruimCoach heeft eerst toestemming van een beheerder nodig.'));
        $('hub-impact').replaceChildren();
        return;
      }
      const [{ actions }, impact] = await Promise.all([api.actions(), api.impact()]);
      renderActions(actions);
      renderImpactSummary(impact);
    },
  };
}
