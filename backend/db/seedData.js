/**
 * @file seedData.js
 * @description Realistic, fully FICTIONAL demo data for a Gemeente Amsterdam
 * Microsoft 365 tenant, plus the CO2 coefficient table.
 *
 * - People and addresses are invented; e-mail uses the reserved `.example` domain.
 * - Dates are stored as "days ago" and converted at seed time, so the demo
 *   always looks current.
 * - Duplicate chains share a `chain` key -> identical simulated content hash.
 */

// --- CO2 coefficients (table co2_metrics) ---------------------------------------------------
// [key, label, low, high, unit, category, derivation, source]
// Derived rows are recomputed by the engine from the inputs; a unit test checks
// that the stored values match, so the table cannot silently drift.
export const CO2_METRICS = [
  ['grid_emission_factor', 'Emissiefactor Nederlandse stroommix', 268, 268, 'g CO2/kWh', 'input',
    '0,268 kg CO2 per kWh', 'Projectbrief v2: bijgewerkte Nederlandse grid-mix'],
  ['storage_power_w_per_tb', 'Vermogen opslag', 0.65, 0.65, 'W/TB', 'input',
    'Gemiddeld continu vermogen per TB opgeslagen data (IT-last)', 'Projectbrief v2'],
  ['pue', 'Power Usage Effectiveness datacenter', 1.185, 1.185, 'factor', 'input',
    'Totale datacenter-energie / IT-energie (koeling en overhead)', 'Projectbrief v2'],
  ['storage_replication_factor', 'Aantal opgeslagen replica\'s', 1, 2, 'kopieën', 'input',
    'Laag: 1 replica; hoog: geo-redundant paar', 'Aanname PoC (conservatieve bovengrens = 2)'],
  ['storage_g_per_gb_year', 'Opslag per GB per jaar', 1.808, 3.617, 'g CO2/GB/jaar', 'derived',
    '0,65 W/TB × 8760 h ÷ 1000 GB/TB ÷ 1000 × PUE 1,185 × replica\'s × 268 g/kWh', 'Afgeleid (≈ 3,6 g bovengrens)'],
  ['network_energy_kwh_per_gb', 'Netwerkenergie per GB', 0.006, 0.015, 'kWh/GB', 'input',
    'Vaste netwerken, recente schattingen (conservatief; oude hoge factoren verlaten)', 'Literatuurbandbreedte, PoC-aanname'],
  ['network_sync_g_per_gb', 'Sync-overhead per GB', 1.608, 4.02, 'g CO2/GB', 'derived',
    'Netwerkenergie × 268 g/kWh', 'Afgeleid'],
  ['edit_cycles_active', 'Bewerkingen per jaar (actief bestand)', 12, 52, 'per jaar', 'behaviour',
    'Maandelijks tot wekelijks een nieuwe versie die gesynchroniseerd en geback-upt wordt', 'Aanname PoC'],
  ['edit_cycles_dormant', 'Bewerkingen per jaar (slapend bestand)', 0, 4, 'per jaar', 'behaviour',
    'Bestand > 90 dagen niet gewijzigd', 'Aanname PoC'],
  ['active_window_days', 'Grens actief/slapend', 90, 90, 'dagen', 'behaviour',
    'Gewijzigd in de laatste 90 dagen = actief', 'Aanname PoC'],
  ['delta_sync_reduction', 'Minder sync-verkeer op SharePoint', 0.3, 0.5, 'fractie', 'behaviour',
    'Eén centrale bibliotheek met delta-sync i.p.v. synchronisatie per gedeelde OneDrive', 'Aanname PoC'],
  ['backup_dedup_reduction', 'Minder back-up-overhead op SharePoint', 0, 0.3, 'fractie', 'behaviour',
    'Site-back-up dedupliceert versies; ondergrens 0 als back-up al dedupliceert', 'Aanname PoC'],
  ['mail_copies_per_recipient', 'Kopieën per ontvanger (bijlage)', 1, 1, 'kopie', 'behaviour',
    'Regel van Rick van Kersbergen: 1 bijlage aan 20 mensen = 20× opslag', 'Projectbrief v2'],
  ['canal_lamp_power_w', 'Vermogen grachtenlantaarn (LED)', 40, 40, 'W', 'metaphor',
    'Eén lantaarn een uur = 0,04 kWh', 'Indicatief'],
  // Everyday examples next to every CO2 amount. Deliberately SMALL: one person's
  // storage saving is grams, so a car trip would make it look meaningless.
  ['kettle_litre_kwh', '1 liter water koken in een waterkoker', 0.104, 0.124, 'kWh', 'metaphor',
    '1 kg water van 15 naar 100 °C = 4,186 kJ/(kg·K) × 85 K = 356 kJ = 0,099 kWh; ÷ rendement waterkoker 0,80–0,95',
    'Natuurkunde (soortelijke warmte water); rendement: gangbare schatting, 2026'],
  ['phone_charge_kwh', 'Smartphone een keer volledig opladen', 0.014, 0.024, 'kWh', 'metaphor',
    'Accu 3.000–5.000 mAh × 3,85 V = 11,5–19,3 Wh; ÷ laadrendement ca. 0,8',
    'Afgeleid uit gangbare accucapaciteit 2024–2026; vergelijk US EPA GHG Equivalencies Calculator (2024, ca. 0,019 kWh)'],
];

// --- SharePoint sites ------------------------------------------------------------------------
// [id, display_name, department|null, folders[]]
export const SITES = [
  ['s01', 'Wonen',                      'Wonen',                      ['Beleid', 'Projecten', 'Overleggen']],
  ['s02', 'Verkeer en Openbare Ruimte', 'Verkeer en Openbare Ruimte', ['Parkeren', 'Projecten', 'Vergunningen']],
  ['s03', 'Financiën',                  'Financiën',                  ['Begroting', 'Rapportages', 'Subsidies']],
  ['s04', 'Duurzaamheid',               'Duurzaamheid',               ['Klimaatbeleid', 'Groene ICT', 'Energie']],
  ['s05', 'Sociaal Domein',             'Sociaal Domein',             ['Beleid', 'Contracten', 'Monitoring']],
  ['s06', 'Informatievoorziening',      'Informatievoorziening',      ['Architectuur', 'Licenties', 'Projecten']],
  ['s07', 'Programma Groene ICT',       null,                         ['Plan van aanpak', 'Metingen']],
];

/** Folder created on demand in a site when a file is moved there by the coach. */
export const MOVED_FOLDER = 'Verhuisd vanuit OneDrive';

/** Default folders in every personal OneDrive root. */
export const ONEDRIVE_FOLDERS = ['Bureaublad', 'Documenten', 'Bijlagen uit e-mail'];

// --- Users (3 per department, so department aggregates meet k-anonymity = 3) ----------------
export const USERS = [
  ['u01', 'Sanne de Vries',     'Wonen'],
  ['u02', 'Thijs Smit',         'Wonen'],
  ['u03', 'Ayşe Demir',         'Wonen'],
  ['u04', 'Mohammed El Amrani', 'Verkeer en Openbare Ruimte'],
  ['u05', 'Iris Kok',           'Verkeer en Openbare Ruimte'],
  ['u06', 'Bram Hendriks',      'Verkeer en Openbare Ruimte'],
  ['u07', 'Lotte Bakker',       'Financiën'],
  ['u08', 'Youssef Haddad',     'Financiën'],
  ['u09', 'Sophie Meijer',      'Financiën'],
  ['u10', 'Daan Jansen',        'Duurzaamheid'],
  ['u11', 'Emma de Boer',       'Duurzaamheid'],
  ['u12', 'Ravi Ramdin',        'Duurzaamheid'],
  ['u13', 'Fatima Yilmaz',      'Sociaal Domein'],
  ['u14', 'Jeroen Bos',         'Sociaal Domein'],
  ['u15', 'Lisa van Leeuwen',   'Sociaal Domein'],
  ['u16', 'Kevin Mulder',       'Informatievoorziening'],
  ['u17', 'Nadia Benali',       'Informatievoorziening'],
  ['u18', 'Tom Peters',         'Informatievoorziening'],
];

/** Site owners (everyone else is a member of their department site). */
export const SITE_OWNERS = { s01: 'u02', s02: 'u04', s03: 'u07', s04: 'u10', s05: 'u13', s06: 'u16', s07: 'u10' };

/** Cross-department programme membership (many-to-many showcase). */
export const PROGRAMME_MEMBERS = { s07: ['u01', 'u10', 'u11', 'u16', 'u07'] };

/** Users that already added a shortcut before today: [userId, siteId, daysAgo]. */
export const EXISTING_SHORTCUTS = [
  ['u02', 's01', 30], ['u10', 's04', 45], ['u10', 's07', 44], ['u16', 's06', 20], ['u07', 's03', 12],
];

// --- Files ---------------------------------------------------------------------------------------
// [filename, ownerId, location, size_mb, times_shared, modified_days_ago, folder, options?]
//   folder  : OneDrive -> one of ONEDRIVE_FOLDERS ; SharePoint -> folder of the owner's department site
//   options : { chain: 'key' }          bit-identical copies share a chain key
//             { migratedDaysAgo: n }    historically moved by its owner (audit + telemetry seeded)
const OD = 'OneDrive';
const SP = 'SharePoint';

export const FILES = [
  // --- Wonen ---------------------------------------------------------------------------------
  ['Beleidsplan_Wonen_v2.docx',                    'u01', OD,   2.4,  9,   3, 'Documenten'],
  ['Woningbouwprogramma_2026-2030.xlsx',           'u01', OD,   5.8, 14,   1, 'Documenten'],
  ['Presentatie_Woonvisie_Raadscommissie.pptx',    'u01', OD,  48.5, 11,   6, 'Documenten', { chain: 'woonvisie' }],
  ['Presentatie_Woonvisie_Raadscommissie (1).pptx','u01', OD,  48.5,  0,   6, 'Bureaublad', { chain: 'woonvisie' }],
  ['Huurtoeslag_analyse_Q3.xlsx',                  'u01', OD,   3.1,  4,  10, 'Documenten'],
  ['Fotos_Bouwlocatie_Sloterdijk.zip',             'u01', OD, 312.0,  5,  60, 'Bureaublad'],
  ['Leegstandsmonitor_2025.xlsx',                  'u01', OD,   7.2,  6, 400, 'Documenten'],
  ['Concept_Brief_Corporaties.docx',               'u01', OD,   0.4,  2,  20, 'Documenten'],
  ['Notities_overleg_corporaties.docx',            'u01', OD,   0.2,  1,  45, 'Bureaublad'],
  ['Actieplan_Groene_ICT_v1_concept.docx',         'u01', OD,   3.2,  0,  14, 'Bijlagen uit e-mail', { chain: 'actieplan' }],
  ['Begroting_2027_concept.xlsx',                  'u01', OD,  12.4,  0,   5, 'Bijlagen uit e-mail', { chain: 'begroting' }],
  ['Woonwagenbeleid_nota.docx',                    'u01', SP,   1.1,  8,  41, 'Beleid', { migratedDaysAgo: 40 }],
  ['Prestatieafspraken_2025_DEF.pdf',              'u02', SP,   1.9, 22,  30, 'Beleid'],
  ['Omgevingsplan_Havenstad_toelichting.pdf',      'u02', SP,  64.0, 13,   9, 'Projecten', { migratedDaysAgo: 25 }],
  ['Presentatie_Woonvisie_Raadscommissie.pptx',    'u02', OD,  48.5,  0,   6, 'Bijlagen uit e-mail', { chain: 'woonvisie' }],
  ['Inspraakreacties_Woonvisie.xlsx',              'u02', OD,   2.7,  7,   2, 'Documenten'],
  ['Middenhuur_monitor_2026.xlsx',                 'u03', OD,   4.2,  9,   5, 'Documenten'],
  ['Presentatie_Woonvisie_Raadscommissie.pptx',    'u03', OD,  48.5,  0,   6, 'Bijlagen uit e-mail', { chain: 'woonvisie' }],
  ['Huisstijl_Gemeente_2026.pdf',                  'u03', OD,  38.0,  0,  70, 'Bijlagen uit e-mail', { chain: 'huisstijl' }],

  // --- Verkeer en Openbare Ruimte ------------------------------------------------------------
  ['Subsidie_Aanvraag_Parkeren.xlsx',              'u04', SP,   2.1, 12,   8, 'Parkeren', { chain: 'subsidie-parkeren' }],
  ['Parkeerbeleid_Centrum_2026.docx',              'u04', OD,   2.0, 18,   4, 'Documenten'],
  ['Verkeersmodel_A10_simulatie.zip',              'u04', OD, 640.0,  7,  25, 'Documenten'],
  ['Bruggen_onderhoudsplan.xlsx',                  'u04', SP,   9.3, 15,   8, 'Projecten', { migratedDaysAgo: 20 }],
  ['Subsidie_Aanvraag_Parkeren.xlsx',              'u05', OD,   2.1,  0,   8, 'Bijlagen uit e-mail', { chain: 'subsidie-parkeren' }],
  ['Fietsparkeren_Stationsplein_tekeningen.pdf',   'u05', OD,  22.5,  9,  14, 'Documenten'],
  ['Kademuren_inspectiefotos_Herengracht.zip',     'u05', SP, 230.0,  6,  22, 'Projecten', { migratedDaysAgo: 45 }],
  ['Kopie van Subsidie_Aanvraag_Parkeren.xlsx',    'u06', OD,   2.1,  0,   8, 'Documenten', { chain: 'subsidie-parkeren' }],
  ['Snelheidsplan_30kmh_evaluatie.pptx',           'u06', OD,  35.2,  1,  33, 'Documenten'],
  ['Bomenkap_vergunningen_overzicht.xlsx',         'u06', OD,   1.9,  5,  10, 'Documenten'],

  // --- Financiën -----------------------------------------------------------------------------
  ['Begroting_2027_concept.xlsx',                  'u07', OD,  12.4, 21,   1, 'Documenten', { chain: 'begroting' }],
  ['Begroting_2027_concept_backup.xlsx',           'u07', OD,  12.4,  0,   1, 'Bureaublad', { chain: 'begroting' }],
  ['Voorjaarsnota_2026_DEF.docx',                  'u07', SP,   3.8, 40,  15, 'Begroting', { migratedDaysAgo: 60 }],
  ['Subsidie_Aanvraag_Parkeren (2).xlsx',          'u07', OD,   2.1,  0,   8, 'Bijlagen uit e-mail', { chain: 'subsidie-parkeren' }],
  ['Begroting_2027_concept.xlsx',                  'u08', OD,  12.4,  0,   1, 'Bijlagen uit e-mail', { chain: 'begroting' }],
  ['Subsidieregister_2026.xlsx',                   'u08', OD,   6.6,  8,   9, 'Documenten'],
  ['Kostenraming_Noord-Zuidlijn_onderhoud.xlsx',   'u08', OD,  15.1, 10,  11, 'Documenten'],
  ['Begroting_2027_concept.xlsx',                  'u09', OD,  12.4,  0,   1, 'Bijlagen uit e-mail', { chain: 'begroting' }],
  ['Treasury_rapportage_Q2.pdf',                   'u09', OD,   2.2,  3, 120, 'Documenten'],
  ['Grondexploitaties_Q3_rapportage.xlsx',         'u09', SP,  21.0, 17,   3, 'Rapportages', { migratedDaysAgo: 18 }],

  // --- Duurzaamheid --------------------------------------------------------------------------
  ['Actieplan_Groene_ICT_v1_concept.docx',         'u10', OD,   3.2,  9,  14, 'Documenten', { chain: 'actieplan' }],
  ['Kopie van Actieplan_Groene_ICT_v1_concept.docx','u10', OD,  3.2,  0,  14, 'Bijlagen uit e-mail', { chain: 'actieplan' }],
  ['Routekaart_Klimaatneutraal_2050.pdf',          'u10', SP,   8.9, 35,   4, 'Klimaatbeleid', { migratedDaysAgo: 90 }],
  ['Warmtenet_haalbaarheid_Zuidoost.docx',         'u10', OD,   6.3, 13,   3, 'Documenten'],
  ['CO2-monitor_dashboard_data.xlsx',              'u11', OD,  24.8,  9,   2, 'Documenten'],
  ['Laadpalen_uitrolplan_2027.xlsx',               'u11', SP,  18.5, 11,   6, 'Energie', { migratedDaysAgo: 35 }],
  ['Workshop_Circulaire_Stad_opname.mp4',          'u11', OD,1450.0,  4,  70, 'Documenten'],
  ['Zonnepanelen_op_daken_inventarisatie.xlsx',    'u12', OD,  11.2,  6,  18, 'Documenten'],
  ['Energiearmoede_aanpak_wijken.docx',            'u12', OD,   2.3,  8,   4, 'Documenten'],
  ['Groene_daken_subsidie_aanvragen.xlsx',         'u12', OD,   3.4,  2,   6, 'Documenten'],

  // --- Sociaal Domein ------------------------------------------------------------------------
  ['Armoedebeleid_evaluatie_2025.docx',            'u13', OD,   1.8,  7,  12, 'Documenten'],
  ['Huisstijl_Gemeente_2026.pdf',                  'u13', SP,  38.0, 60,  70, 'Beleid', { chain: 'huisstijl' }],
  ['Jeugdzorg_contracten_overzicht.xlsx',          'u13', SP,   4.1, 16,  16, 'Contracten', { migratedDaysAgo: 15 }],
  ['Schuldhulpverlening_cijfers_Q3.xlsx',          'u14', OD,   2.9,  5,   5, 'Documenten'],
  ['Huisstijl_Gemeente_2026.pdf',                  'u14', OD,  38.0,  0,  70, 'Bijlagen uit e-mail', { chain: 'huisstijl' }],
  ['Wmo_klanttevredenheid_rapport.pdf',            'u14', OD,   5.5,  3, 200, 'Documenten'],
  ['Buurtteams_roosters_november.xlsx',            'u15', OD,   0.9, 24,   0, 'Documenten'],
  ['Persoonlijk_ontwikkelplan.docx',               'u15', OD,   0.3,  0,  90, 'Documenten'],

  // --- Informatievoorziening -----------------------------------------------------------------
  ['Migratieplan_M365_fase2.docx',                 'u16', OD,   3.3, 17,   2, 'Documenten'],
  ['Actieplan_Groene_ICT_v1_concept (1).docx',     'u16', OD,   3.2,  0,  14, 'Bureaublad', { chain: 'actieplan' }],
  ['Incidentrapportage_Q3.pdf',                    'u16', SP,   1.7, 14,  11, 'Architectuur', { migratedDaysAgo: 10 }],
  ['Licentieoverzicht_2026.xlsx',                  'u17', OD,   2.1,  5,   9, 'Documenten'],
  ['Netwerkdiagram_stadhuis.vsdx',                 'u17', OD,   9.8,  3,  30, 'Documenten'],
  ['Huisstijl_Gemeente_2026.pdf',                  'u17', OD,  38.0,  0,  70, 'Bijlagen uit e-mail', { chain: 'huisstijl' }],
  ['Applicatieportfolio_overzicht.xlsx',           'u18', OD,   5.0, 12,   7, 'Documenten'],
  ['Back-upbeleid_v4.docx',                        'u18', OD,   0.7,  6, 500, 'Documenten'],
  ['Dataclassificatie_richtlijn_BIO.pdf',          'u18', OD,   1.4,  9,  21, 'Documenten'],
];

// --- Mail metadata (aggregated: department, month, size, recipient COUNT only) -------------------
// [department, months_ago, size_mb, recipient_count]
export const MAIL_ATTACHMENTS = [
  ['Wonen', 0, 48.5, 20], ['Wonen', 0, 3.2, 8], ['Wonen', 1, 12.4, 15], ['Wonen', 2, 5.8, 25],
  ['Verkeer en Openbare Ruimte', 0, 2.1, 30], ['Verkeer en Openbare Ruimte', 1, 22.5, 12], ['Verkeer en Openbare Ruimte', 2, 9.3, 6],
  ['Financiën', 0, 12.4, 40], ['Financiën', 1, 3.8, 55], ['Financiën', 2, 6.6, 9],
  ['Duurzaamheid', 0, 3.2, 18], ['Duurzaamheid', 1, 24.8, 10], ['Duurzaamheid', 2, 8.9, 35],
  ['Sociaal Domein', 0, 38.0, 60], ['Sociaal Domein', 1, 1.8, 14], ['Sociaal Domein', 2, 4.1, 7],
  ['Informatievoorziening', 0, 3.3, 22], ['Informatievoorziening', 1, 9.8, 5], ['Informatievoorziening', 2, 1.7, 45],
];

/** Historical Smart Alert outcomes: [department, days_ago, size_mb, recipients, 'share_link'|'send_anyway'] */
export const PAST_MAIL_DECISIONS = [
  ['Wonen', 12, 48.5, 20, 'share_link'], ['Financiën', 9, 12.4, 40, 'share_link'],
  ['Sociaal Domein', 6, 38.0, 60, 'share_link'], ['Duurzaamheid', 3, 8.9, 35, 'send_anyway'],
  ['Informatievoorziening', 2, 1.7, 45, 'share_link'],
];
