/**
 * Unit tests for the demo folder rules (file name -> folder name, never contents).
 * Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestFolder } from '../backend/services/folderSuggestion.js';

const wonen = [{ id: 1, name: 'Beleid' }, { id: 2, name: 'Overleggen' }, { id: 3, name: 'Projecten' }, { id: 4, name: 'Verhuisd vanuit OneDrive' }];
const financien = [{ id: 5, name: 'Begroting' }, { id: 6, name: 'Rapportages' }, { id: 7, name: 'Subsidies' }, { id: 8, name: 'Verhuisd vanuit OneDrive' }];

test('a word in the file name picks the matching folder', () => {
  assert.equal(suggestFolder('Beleidsplan_Wonen_v2.docx', wonen).name, 'Beleid');
  assert.equal(suggestFolder('Notities_overleg_corporaties.docx', wonen).name, 'Overleggen');
  assert.equal(suggestFolder('Fotos_Bouwlocatie_Sloterdijk.zip', wonen).name, 'Projecten');
  assert.equal(suggestFolder('Begroting_2027_concept.xlsx', financien).name, 'Begroting');
  assert.equal(suggestFolder('Subsidieregister_2026.xlsx', financien).name, 'Subsidies');
});

test('only folders that exist on the site are suggested; otherwise the coach folder', () => {
  const s = suggestFolder('Huurtoeslag_analyse_Q3.xlsx', wonen);
  assert.equal(s.name, 'Verhuisd vanuit OneDrive');
  assert.equal(s.matched, false);
  assert.equal(suggestFolder('Leegstandsmonitor_2025.xlsx', wonen).matched, false); // no "Monitoring" folder on Wonen
});
