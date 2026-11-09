/**
 * @file seedData.js
 * @description Realistic, fully FICTIONAL demo data for a Gemeente Amsterdam
 * Microsoft 365 tenant. Names and e-mail addresses are made up and use the
 * reserved `.example` domain, so the dataset contains no personal data.
 *
 * Dates are stored as "days ago" and turned into real timestamps at seed time,
 * so the demo always looks current no matter when the seed script runs.
 */

/** Simulated Entra ID users. u01 is the default signed-in user of the demo. */
export const USERS = [
  { id: 'u01', display_name: 'Sanne de Vries',     email: 's.devries@amsterdam.example',  department: 'Wonen' },
  { id: 'u02', display_name: 'Mohammed El Amrani', email: 'm.elamrani@amsterdam.example', department: 'Verkeer en Openbare Ruimte' },
  { id: 'u03', display_name: 'Lotte Bakker',       email: 'l.bakker@amsterdam.example',   department: 'Financiën' },
  { id: 'u04', display_name: 'Daan Jansen',        email: 'd.jansen@amsterdam.example',   department: 'Duurzaamheid' },
  { id: 'u05', display_name: 'Fatima Yilmaz',      email: 'f.yilmaz@amsterdam.example',   department: 'Sociaal Domein' },
  { id: 'u06', display_name: 'Pieter van Dijk',    email: 'p.vandijk@amsterdam.example',  department: 'Stadsdeel Centrum' },
  { id: 'u07', display_name: 'Noor Visser',        email: 'n.visser@amsterdam.example',   department: 'Communicatie' },
  { id: 'u08', display_name: 'Kevin Mulder',       email: 'k.mulder@amsterdam.example',   department: 'Informatievoorziening' },
  // Second colleague in four departments, so department totals differ from personal totals.
  { id: 'u09', display_name: 'Thijs Smit',         email: 't.smit@amsterdam.example',     department: 'Wonen' },
  { id: 'u10', display_name: 'Emma de Boer',       email: 'e.deboer@amsterdam.example',   department: 'Duurzaamheid' },
  { id: 'u11', display_name: 'Youssef Haddad',     email: 'y.haddad@amsterdam.example',   department: 'Financiën' },
  { id: 'u12', display_name: 'Iris Kok',           email: 'i.kok@amsterdam.example',      department: 'Verkeer en Openbare Ruimte' },
];

/**
 * Drive items as compact tuples:
 * [filename, location, file_size_mb, share_count, last_accessed_days_ago, owner_user_id, migrated_days_ago?]
 *
 * A seventh value means the file was moved to SharePoint by its owner N days
 * ago (a historical migration, so the dashboard is not empty on first start).
 * SharePoint files without it were created on SharePoint (no saving counted).
 */
export const FILES = [
  // --- u01 · Wonen -----------------------------------------------------------
  ['Beleidsplan_Wonen_v2.docx',                       'OneDrive',     2.4,   9,   3, 'u01'],
  ['Woningbouwprogramma_2026-2030.xlsx',              'OneDrive',     5.8,  14,   1, 'u01'],
  ['Presentatie_Woonvisie_Raadscommissie.pptx',       'OneDrive',    48.5,  11,   6, 'u01'],
  ['Huurtoeslag_analyse_Q3.xlsx',                     'OneDrive',     3.1,   4,  10, 'u01'],
  ['Concept_Brief_Corporaties.docx',                  'OneDrive',     0.4,   2,  20, 'u01'],
  ['Notities_overleg_woningcorporaties.docx',         'OneDrive',     0.2,   1,  45, 'u01'],
  ['Prestatieafspraken_2025_DEF.pdf',                 'SharePoint',   1.9,  22,  30, 'u01'],
  ['Leegstandsmonitor_2025.xlsx',                     'OneDrive',     7.2,   6, 400, 'u01'],
  ['Fotos_Bouwlocatie_Sloterdijk.zip',                'OneDrive',   312.0,   5,  60, 'u01'],
  ['Woonwagenbeleid_nota.docx',                       'SharePoint',   1.1,   8,  41, 'u01', 40],

  // --- u02 · Verkeer en Openbare Ruimte -------------------------------------
  ['Budget_Verkeer_FINAL.xlsx',                       'OneDrive',     4.6,  12,   2, 'u02'],
  ['Budget_Verkeer_FINAL_v2_echt.xlsx',               'OneDrive',     4.7,   3,   5, 'u02'],
  ['Parkeerbeleid_Centrum_2026.docx',                 'OneDrive',     2.0,  18,   4, 'u02'],
  ['Verkeersmodel_A10_simulatie.zip',                 'OneDrive',   640.0,   7,  25, 'u02'],
  ['Bruggen_onderhoudsplan.xlsx',                     'SharePoint',   9.3,  15,   8, 'u02', 20],
  ['Fietsparkeren_Stationsplein_tekeningen.pdf',      'OneDrive',    22.5,   9,  14, 'u02'],
  ['Snelheidsplan_30kmh_evaluatie.pptx',              'OneDrive',    35.2,   1,  33, 'u02'],
  ['Afsluitingen_kademuren_planning.xlsx',            'SharePoint',   1.6,  26,   1, 'u02'],

  // --- u03 · Financiën -------------------------------------------------------
  ['Begroting_2027_concept.xlsx',                     'OneDrive',    12.4,  21,   1, 'u03'],
  ['Voorjaarsnota_2026_DEF.docx',                     'SharePoint',   3.8,  40,  15, 'u03', 60],
  ['Facturen_export_oktober.csv',                     'OneDrive',    18.0,   2,   7, 'u03'],
  ['Subsidieregister_2026.xlsx',                      'OneDrive',     6.6,   8,   9, 'u03'],
  ['Treasury_rapportage_Q2.pdf',                      'OneDrive',     2.2,   3, 120, 'u03'],
  ['Kostenraming_Noord-Zuidlijn_onderhoud.xlsx',      'OneDrive',    15.1,  10,  11, 'u03'],
  ['Accountantsverslag_2025.pdf',                     'SharePoint',   4.4,  30,  50, 'u03'],

  // --- u04 · Duurzaamheid ----------------------------------------------------
  ['Routekaart_Klimaatneutraal_2050.pdf',             'SharePoint',   8.9,  35,   4, 'u04', 90],
  ['Warmtenet_haalbaarheid_Zuidoost.docx',            'OneDrive',     6.3,  13,   3, 'u04'],
  ['Zonnepanelen_op_daken_inventarisatie.xlsx',       'OneDrive',    11.2,   6,  18, 'u04'],
  ['CO2-monitor_dashboard_data.xlsx',                 'OneDrive',    24.8,   9,   2, 'u04'],
  ['Workshop_Circulaire_Stad_opname.mp4',             'OneDrive',  1450.0,   4,  70, 'u04'],
  ['Groene_daken_subsidie_aanvragen.xlsx',            'OneDrive',     3.4,   2,   6, 'u04'],
  ['Luchtkwaliteit_meetdata_2025.csv',                'SharePoint',  56.0,  12,  21, 'u04'],

  // --- u05 · Sociaal Domein --------------------------------------------------
  ['Armoedebeleid_evaluatie_2025.docx',               'OneDrive',     1.8,   7,  12, 'u05'],
  ['Schuldhulpverlening_cijfers_Q3.xlsx',             'OneDrive',     2.9,   5,   5, 'u05'],
  ['Jeugdzorg_contracten_overzicht.xlsx',             'SharePoint',   4.1,  16,  16, 'u05', 15],
  ['Wmo_klanttevredenheid_rapport.pdf',               'OneDrive',     5.5,   3, 200, 'u05'],
  ['Buurtteams_roosters_november.xlsx',               'OneDrive',     0.9,  24,   0, 'u05'],
  ['Persoonlijk_ontwikkelplan.docx',                  'OneDrive',     0.3,   0,  90, 'u05'],

  // --- u06 · Stadsdeel Centrum ----------------------------------------------
  ['Evenementenkalender_2027.xlsx',                   'OneDrive',     1.4,  19,   2, 'u06'],
  ['Vergunningen_terrassen_overzicht.xlsx',           'OneDrive',     3.7,   8,   6, 'u06'],
  ['Afvalinzameling_route_Jordaan.pdf',               'OneDrive',    14.6,   5,   8, 'u06'],
  ['Bewonersavond_Wallen_presentatie.pptx',           'SharePoint',  27.3,  10,  31, 'u06', 30],
  ['Handhaving_rapportage_oktober.docx',              'OneDrive',     1.2,   4,   3, 'u06'],
  ['Koningsdag_draaiboek_2027.docx',                  'OneDrive',     2.6,  31,   1, 'u06'],

  // --- u07 · Communicatie ----------------------------------------------------
  ['Huisstijl_handboek_2026.pdf',                     'SharePoint',  38.0,  60,  20, 'u07'],
  ['Persberichten_planning_Q4.xlsx',                  'OneDrive',     0.8,  11,   1, 'u07'],
  ['Campagne_Afval_Scheiden_video.mp4',               'OneDrive',   890.0,   6,  15, 'u07'],
  ['Social_media_contentkalender.xlsx',               'OneDrive',     1.1,   9,   0, 'u07'],
  ['Fotoarchief_Raadsvergadering_september.zip',      'OneDrive',   420.0,   3,  35, 'u07'],
  ['Interne_nieuwsbrief_concept.docx',                'OneDrive',     0.6,   2,   4, 'u07'],

  // --- u08 · Informatievoorziening ------------------------------------------
  ['Migratieplan_M365_fase2.docx',                    'OneDrive',     3.3,  17,   2, 'u08'],
  ['Licentieoverzicht_2026.xlsx',                     'OneDrive',     2.1,   5,   9, 'u08'],
  ['Netwerkdiagram_stadhuis.vsdx',                    'OneDrive',     9.8,   3,  30, 'u08'],
  ['Incidentrapportage_Q3.pdf',                       'SharePoint',   1.7,  14,  11, 'u08', 10],
  ['Back-upbeleid_v4.docx',                           'OneDrive',     0.7,   6, 500, 'u08'],
  ['Applicatieportfolio_overzicht.xlsx',              'OneDrive',     5.0,  12,   7, 'u08'],

  // --- u09 · Wonen -----------------------------------------------------------
  ['Omgevingsplan_Havenstad_toelichting.pdf',         'SharePoint',  64.0,  13,   9, 'u09', 25],
  ['Middenhuur_monitor_2026.xlsx',                    'SharePoint',   4.2,   9,   5, 'u09', 12],
  ['Inspraakreacties_Woonvisie.xlsx',                 'OneDrive',     2.7,   7,   2, 'u09'],

  // --- u10 · Duurzaamheid ----------------------------------------------------
  ['Laadpalen_uitrolplan_2027.xlsx',                  'SharePoint',  18.5,  11,   6, 'u10', 35],
  ['Energiearmoede_aanpak_wijken.docx',               'OneDrive',     2.3,   8,   4, 'u10'],

  // --- u11 · Financiën -------------------------------------------------------
  ['Grondexploitaties_Q3_rapportage.xlsx',            'SharePoint',  21.0,  17,   3, 'u11', 18],
  ['Bezuinigingsopties_2027_vertrouwelijk.xlsx',      'OneDrive',     1.5,   2,   1, 'u11'],

  // --- u12 · Verkeer en Openbare Ruimte -------------------------------------
  ['Kademuren_inspectiefotos_Herengracht.zip',        'SharePoint', 230.0,   6,  22, 'u12', 45],
  ['Bomenkap_vergunningen_overzicht.xlsx',            'OneDrive',     1.9,   5,  10, 'u12'],
];

/**
 * Historical "Nu niet" answers, older than the snooze window, so they appear in
 * the coaching statistics without hiding the files from today's scan.
 * [filename, user_id, days_ago]
 */
export const PAST_DECLINES = [
  ['Budget_Verkeer_FINAL.xlsx', 'u02', 30],
  ['Huurtoeslag_analyse_Q3.xlsx', 'u01', 21],
];
