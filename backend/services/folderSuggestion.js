/**
 * @file folderSuggestion.js
 * @description Suggests the folder on a team site where a document probably
 * belongs, e.g. "Begroting_2027_concept.xlsx" -> folder "Begroting".
 *
 * DEMO RULES: a word in the FILE NAME is matched to a FOLDER NAME of the team
 * library. Only names are used, never the contents of a file (privacy rule), and
 * no AI. The user always sees the suggestion and can pick another folder.
 *
 * TODO(teams): the folder names come from
 * GET /drives/{drive-id}/root/children?$select=id,name,folder (Files.Read.All,
 * already needed). The rules below are examples; the real version needs a
 * rule list that DIV / records management agrees on per team.
 */

import { MOVED_FOLDER } from '../db/seedData.js';

/**
 * Ordered rules: [words in the file name, folder name]. The first rule whose
 * folder exists on the target site wins. Words are matched case-insensitively
 * anywhere in the file name.
 */
export const FOLDER_RULES = Object.freeze([
  [['begroting', 'voorjaarsnota', 'kostenraming', 'treasury'], 'Begroting'],
  [['rapportage', 'rapport'], 'Rapportages'],
  [['monitor', 'cijfers', 'evaluatie'], 'Monitoring'],
  [['subsidie'], 'Subsidies'],
  [['contract'], 'Contracten'],
  [['parkeer', 'parkeren'], 'Parkeren'],
  [['vergunning'], 'Vergunningen'],
  [['klimaat', 'co2'], 'Klimaatbeleid'],
  [['energie', 'warmte', 'zonnepanelen', 'laadpalen'], 'Energie'],
  [['groene_ict', 'groene ict'], 'Groene ICT'],
  [['licentie'], 'Licenties'],
  [['architectuur', 'netwerk', 'applicatie', 'migratie', 'back-up', 'dataclassificatie'], 'Architectuur'],
  [['overleg', 'notities', 'notulen', 'brief'], 'Overleggen'],
  [['beleid', 'visie', 'nota', 'richtlijn'], 'Beleid'],
  [['project', 'programma', 'bouw', 'tekening', 'fotos', 'plan'], 'Projecten'],
]);

/**
 * @param {string} filename
 * @param {{ id: number, name: string }[]} folders folders of the target team library
 * @returns {{ id: number, name: string, matched: boolean } | null}
 *   matched = false when no rule applied and the coach's own folder is suggested
 */
export function suggestFolder(filename, folders) {
  const name = filename.toLowerCase();
  for (const [words, folderName] of FOLDER_RULES) {
    if (!words.some((w) => name.includes(w))) continue;
    const folder = folders.find((f) => f.name === folderName);
    if (folder) return { id: folder.id, name: folder.name, matched: true };
  }
  // No rule applies: suggest the coach's own "Verhuisd vanuit OneDrive" folder.
  const fallback = folders.find((f) => f.name === MOVED_FOLDER);
  return fallback ? { id: fallback.id, name: fallback.name, matched: false } : null;
}
