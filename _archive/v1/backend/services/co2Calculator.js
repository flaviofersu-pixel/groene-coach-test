/**
 * @file co2Calculator.js
 * @description The Green IT calculation engine.
 *
 * Pure functions only (no database, no I/O). Every input arrives as an argument
 * and every coefficient is a named constant, so the model is easy to unit-test,
 * audit and recalibrate. ARCHITECTURE.md explains it in more detail.
 *
 * MODEL OVERVIEW — annual footprint of ONE file in a given location:
 *
 *   size_gb          = file_size_mb / 1024
 *
 *   (1) Storage impact: cloud storage is powered and cooled 24/7.
 *       copies_OneDrive   = 1 + DUPLICATE_COPY_RATIO x share_count
 *       copies_SharePoint = 1                      (single source of truth)
 *       storage_kwh       = size_gb x copies x STORAGE_KWH_PER_GB_YEAR
 *
 *   (2) Network sync impact: every collaborator's client keeps its own copy in
 *       sync, so traffic grows with the number of people it is shared with.
 *       sync_gb_OneDrive   = size_gb x share_count x SYNC_CYCLES_PER_YEAR
 *       sync_gb_SharePoint = sync_gb_OneDrive x (1 - SHAREPOINT_SYNC_REDUCTION)
 *       network_kwh        = sync_gb x NETWORK_KWH_PER_GB
 *
 *   (3) Emissions:
 *       co2_grams = (storage_kwh + network_kwh) x GRID_EMISSION_FACTOR_G_PER_KWH
 *
 *   Savings of a migration = footprint(OneDrive) - footprint(SharePoint).
 */

/**
 * Emission & energy coefficients.
 * These are ASSUMPTIONS for a proof of concept, not measured values. They are
 * deliberately rounded and documented so a reviewer can swap in better data.
 */
export const CO2_FACTORS = Object.freeze({
  /** Energy to keep 1 GB in a data centre for one year, incl. cooling/PUE (given in brief). */
  STORAGE_KWH_PER_GB_YEAR: 0.015,

  /**
   * Grams CO2-equivalent per kWh of electricity. 300 g/kWh is a rounded,
   * location-based value in the range reported for the Dutch electricity mix in
   * recent years (roughly 250-400 g/kWh, falling as renewables grow).
   */
  GRID_EMISSION_FACTOR_G_PER_KWH: 300,

  /**
   * Energy intensity of moving 1 GB over fixed networks (access + core).
   * Published estimates vary widely (~0.005-0.06 kWh/GB depending on year and
   * method, cf. the declining trend in Aslan et al., 2018). 0.03 is a
   * mid-range value.
   */
  NETWORK_KWH_PER_GB: 0.03,

  /**
   * How often, per year, each collaborator's client transfers the full file
   * because it changed. 52 = roughly one full re-sync per collaborator per week.
   */
  SYNC_CYCLES_PER_YEAR: 52,

  /** Reduction of active sync traffic from SharePoint's centralised delta-sync (given in brief: 40 %). */
  SHAREPOINT_SYNC_REDUCTION: 0.40,

  /**
   * Fraction of collaborators that create a redundant cloud copy of a file
   * shared from someone's personal OneDrive ("save a copy", e-mail attachment,
   * re-upload). In a SharePoint team site everyone works on one copy, so the
   * redundancy disappears. Set to 0 for a strictly conservative scenario.
   */
  ONEDRIVE_DUPLICATE_COPY_RATIO: 0.25,

  MB_PER_GB: 1024,
});

/**
 * Coefficients used to turn abstract grams/kWh into Amsterdam-flavoured
 * equivalents ("positive reinforcement metaphors" on the dashboard).
 */
export const EQUIVALENCE_FACTORS = Object.freeze({
  /** Typical power draw of an LED canal lantern (grachtenlantaarn), in watts. */
  STREETLIGHT_WATTS: 40,
  /** Average burning time per night (~4,100 hours a year, dusk to dawn). */
  STREETLIGHT_HOURS_PER_NIGHT: 11.2,
  /** CO2 a mature city tree absorbs per year, in grams (commonly cited ~20-25 kg). */
  TREE_G_CO2_PER_YEAR: 22000,
  /** Indicative real-world emissions of an average petrol car, grams CO2 per km. */
  CAR_G_CO2_PER_KM: 150,
});

export const LOCATIONS = Object.freeze({ ONEDRIVE: 'OneDrive', SHAREPOINT: 'SharePoint' });

/**
 * Guards against invalid input so the engine never silently returns NaN.
 * @param {{file_size_mb:number, share_count:number}} file
 */
function assertValidFile(file) {
  if (!file || typeof file !== 'object') throw new TypeError('file must be an object');
  const { file_size_mb: size, share_count: shares } = file;
  if (!Number.isFinite(size) || size < 0) throw new RangeError('file_size_mb must be a non-negative number');
  if (!Number.isInteger(shares) || shares < 0) throw new RangeError('share_count must be a non-negative integer');
}

/**
 * Calculates the yearly energy use and emissions of one file in one location.
 *
 * @param {{file_size_mb:number, share_count:number}} file
 * @param {'OneDrive'|'SharePoint'} location
 * @param {typeof CO2_FACTORS} [f=CO2_FACTORS] Override coefficients (tests / scenarios).
 * @returns {{
 *   location: string, storage_copies: number, storage_kwh: number,
 *   sync_volume_gb: number, network_kwh: number, total_kwh: number,
 *   storage_co2_grams: number, network_co2_grams: number, co2_grams: number
 * }} Annual figures (per year).
 */
export function calculateAnnualFootprint(file, location, f = CO2_FACTORS) {
  assertValidFile(file);
  if (!Object.values(LOCATIONS).includes(location)) {
    throw new RangeError(`location must be one of ${Object.values(LOCATIONS).join(', ')}`);
  }

  const isOneDrive = location === LOCATIONS.ONEDRIVE;
  const sizeGb = file.file_size_mb / f.MB_PER_GB;

  // (1) Storage: personal-OneDrive sharing leads to redundant copies.
  const storageCopies = isOneDrive ? 1 + f.ONEDRIVE_DUPLICATE_COPY_RATIO * file.share_count : 1;
  const storageKwh = sizeGb * storageCopies * f.STORAGE_KWH_PER_GB_YEAR;

  // (2) Network: one sync stream per collaborator; SharePoint delta-sync removes 40 %.
  const oneDriveSyncGb = sizeGb * file.share_count * f.SYNC_CYCLES_PER_YEAR;
  const syncVolumeGb = isOneDrive ? oneDriveSyncGb : oneDriveSyncGb * (1 - f.SHAREPOINT_SYNC_REDUCTION);
  const networkKwh = syncVolumeGb * f.NETWORK_KWH_PER_GB;

  // (3) Convert energy to emissions.
  const ef = f.GRID_EMISSION_FACTOR_G_PER_KWH;
  return {
    location,
    storage_copies: storageCopies,
    storage_kwh: storageKwh,
    sync_volume_gb: syncVolumeGb,
    network_kwh: networkKwh,
    total_kwh: storageKwh + networkKwh,
    storage_co2_grams: storageKwh * ef,
    network_co2_grams: networkKwh * ef,
    co2_grams: (storageKwh + networkKwh) * ef,
  };
}

/**
 * Yearly savings achieved by moving a file from OneDrive to SharePoint.
 *
 * @param {{file_size_mb:number, share_count:number}} file
 * @param {typeof CO2_FACTORS} [f=CO2_FACTORS]
 * @returns {{
 *   before: ReturnType<typeof calculateAnnualFootprint>,
 *   after: ReturnType<typeof calculateAnnualFootprint>,
 *   storage_kwh_saved: number, network_kwh_saved: number,
 *   energy_kwh_saved: number, co2_grams_saved: number, reduction_percent: number
 * }}
 */
export function calculateMigrationSavings(file, f = CO2_FACTORS) {
  const before = calculateAnnualFootprint(file, LOCATIONS.ONEDRIVE, f);
  const after = calculateAnnualFootprint(file, LOCATIONS.SHAREPOINT, f);
  const co2Saved = before.co2_grams - after.co2_grams;

  return {
    before,
    after,
    storage_kwh_saved: before.storage_kwh - after.storage_kwh,
    network_kwh_saved: before.network_kwh - after.network_kwh,
    energy_kwh_saved: before.total_kwh - after.total_kwh,
    co2_grams_saved: co2Saved,
    // Guard against division by zero for empty / unshared files.
    reduction_percent: before.co2_grams > 0 ? (co2Saved / before.co2_grams) * 100 : 0,
  };
}

/**
 * Translates savings into tangible Amsterdam metaphors.
 *
 * @param {{energy_kwh:number, co2_grams:number}} savings
 * @param {typeof EQUIVALENCE_FACTORS} [e=EQUIVALENCE_FACTORS]
 * @returns {{
 *   streetlight_hours: number, streetlight_nights: number,
 *   tree_days: number, trees_for_a_year: number, car_km_avoided: number
 * }}
 */
export function calculateEquivalents({ energy_kwh, co2_grams }, e = EQUIVALENCE_FACTORS) {
  const streetlightHours = (energy_kwh * 1000) / e.STREETLIGHT_WATTS;
  return {
    streetlight_hours: streetlightHours,
    streetlight_nights: streetlightHours / e.STREETLIGHT_HOURS_PER_NIGHT,
    tree_days: co2_grams / (e.TREE_G_CO2_PER_YEAR / 365),
    trees_for_a_year: co2_grams / e.TREE_G_CO2_PER_YEAR,
    car_km_avoided: co2_grams / e.CAR_G_CO2_PER_KM,
  };
}

/**
 * Rounds a number for presentation (API responses). Calculations themselves
 * always use full precision; rounding only happens at the edge.
 * @param {number} value
 * @param {number} [decimals=2]
 */
export function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
