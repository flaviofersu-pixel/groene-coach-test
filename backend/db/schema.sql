-- =============================================================================
-- schema.sql — Microsoft 365 tenant simulation ("Graph mock database")
--
-- Models the parts of Microsoft 365 that OpruimCoach needs: users,
-- department SharePoint sites, the personal OneDrive tree, drive items and
-- the CO2 coefficients. All statements are idempotent (IF NOT EXISTS).
--
-- Privacy by design: tables are split into
--   (a) tenant data         users, sharepoint_sites, site_memberships, sharepoint_folders, onedrive_items, files
--   (b) functional state    snoozes (auto-purged), migration_log (own-user audit trail, retention-limited)
--   (c) aggregated telemetry telemetry_daily, mail_attachment_stats   -> contain NO user identifiers
--   (d) model parameters    co2_metrics
-- =============================================================================

-- --- (a) Tenant data -----------------------------------------------------------

-- Department (and programme) SharePoint team sites. Every site exposes one
-- document library; a OneDrive shortcut is named "<display_name> - <library_name>".
CREATE TABLE IF NOT EXISTS sharepoint_sites (
  id            TEXT PRIMARY KEY,                 -- 's01'
  display_name  TEXT NOT NULL,                    -- 'Wonen'
  department    TEXT,                             -- NULL = cross-department programme site
  web_url       TEXT NOT NULL UNIQUE,             -- fictional *.sharepoint.example URL
  library_name  TEXT NOT NULL DEFAULT 'Documenten'
);

-- Simulated Entra ID directory.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                 -- 'u01'
  display_name  TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,             -- fictional *.example address
  department    TEXT NOT NULL
);

-- Many-to-many: a user is a member of their department site and possibly of
-- programme sites; a site has many members.
CREATE TABLE IF NOT EXISTS site_memberships (
  user_id  TEXT NOT NULL REFERENCES users(id),
  site_id  TEXT NOT NULL REFERENCES sharepoint_sites(id),
  role     TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (user_id, site_id)
);

-- Top-level folders inside a site's document library.
CREATE TABLE IF NOT EXISTS sharepoint_folders (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id  TEXT NOT NULL REFERENCES sharepoint_sites(id),
  name     TEXT NOT NULL,
  UNIQUE (site_id, name)
);

-- The personal OneDrive tree: folders and SharePoint SHORTCUT LINK OBJECTS.
-- A shortcut mirrors Graph's driveItem.remoteItem: it points at a site library.
CREATE TABLE IF NOT EXISTS onedrive_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        TEXT    NOT NULL REFERENCES users(id),
  parent_id       INTEGER REFERENCES onedrive_items(id),  -- NULL = OneDrive root
  name            TEXT    NOT NULL,
  item_type       TEXT    NOT NULL CHECK (item_type IN ('folder', 'shortcut')),
  target_site_id  TEXT    REFERENCES sharepoint_sites(id),
  created_at      TEXT    NOT NULL,
  -- A shortcut always has a target; a folder never has one.
  CHECK ((item_type = 'shortcut') = (target_site_id IS NOT NULL))
);
-- One shortcut per user per site (makes the mapper endpoint idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS ux_onedrive_shortcut
  ON onedrive_items (owner_id, target_site_id) WHERE item_type = 'shortcut';

-- Drive items. The first eight columns are the ones required by the brief.
CREATE TABLE IF NOT EXISTS files (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  filename              TEXT    NOT NULL,
  current_location      TEXT    NOT NULL CHECK (current_location IN ('OneDrive', 'SharePoint')),
  size_mb               REAL    NOT NULL CHECK (size_mb >= 0),
  owner_id              TEXT    NOT NULL REFERENCES users(id),
  department            TEXT    NOT NULL,
  times_shared          INTEGER NOT NULL DEFAULT 0 CHECK (times_shared >= 0),
  last_modified         TEXT    NOT NULL,           -- ISO-8601 UTC
  -- Extensions ---------------------------------------------------------------
  content_hash          TEXT    NOT NULL,           -- simulated Graph quickXorHash: equal hash = bit-identical copy
  onedrive_folder_id    INTEGER REFERENCES onedrive_items(id),
  sharepoint_folder_id  INTEGER REFERENCES sharepoint_folders(id),
  status                TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'recycled')),
  recycled_at           TEXT,
  -- Exactly one parent container, matching the location.
  CHECK (
    (current_location = 'OneDrive'   AND onedrive_folder_id IS NOT NULL AND sharepoint_folder_id IS NULL) OR
    (current_location = 'SharePoint' AND sharepoint_folder_id IS NOT NULL AND onedrive_folder_id IS NULL)
  )
);

-- ARCHIEFWET GUARANTEE AT DATABASE LEVEL: drive items can never be hard-deleted.
-- "Clean-up" only ever sets status = 'recycled' (restorable). Re-seeding drops
-- the whole table, which does not fire triggers.
CREATE TRIGGER IF NOT EXISTS trg_files_never_delete
BEFORE DELETE ON files
BEGIN
  SELECT RAISE(ABORT, 'Archiefwet: drive items are never hard-deleted by OpruimCoach');
END;

-- --- (b) Functional state ---------------------------------------------------------

-- "Nu niet": hides one suggestion for one user until `until`. Purged afterwards.
CREATE TABLE IF NOT EXISTS snoozes (
  user_id  TEXT    NOT NULL REFERENCES users(id),
  file_id  INTEGER NOT NULL REFERENCES files(id),
  until    TEXT    NOT NULL,
  PRIMARY KEY (user_id, file_id)
);

-- Personal audit trail. Only ever returned to the user it belongs to; rows
-- older than config.auditRetentionDays are purged.
CREATE TABLE IF NOT EXISTS migration_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT    NOT NULL REFERENCES users(id),
  file_id           INTEGER NOT NULL REFERENCES files(id),
  action            TEXT    NOT NULL CHECK (action IN ('migrate', 'recycle_duplicate', 'restore')),
  from_location     TEXT    NOT NULL,
  from_folder       TEXT    NOT NULL,
  to_location       TEXT    NOT NULL,             -- 'SharePoint' | 'Prullenbak' | 'OneDrive'
  to_site_id        TEXT    REFERENCES sharepoint_sites(id),
  size_mb           REAL    NOT NULL,
  storage_freed_mb  REAL    NOT NULL DEFAULT 0,
  co2_low_g         REAL    NOT NULL,
  co2_high_g        REAL    NOT NULL,
  kwh_low           REAL    NOT NULL,
  kwh_high          REAL    NOT NULL,
  at                TEXT    NOT NULL
);

-- --- (c) Aggregated telemetry (NO user identifiers) ----------------------------------

-- One row per day x department x team x event type, incremented in place.
-- team_site_id = the team (SharePoint team site) a saving counts for: the team the
-- document was moved TO. '' = no team (duplicate clean-up, mail links): those only
-- count in the organisation total. Still no user identifiers.
CREATE TABLE IF NOT EXISTS telemetry_daily (
  day               TEXT    NOT NULL,             -- 'YYYY-MM-DD'
  department        TEXT    NOT NULL,
  team_site_id      TEXT    NOT NULL DEFAULT '',
  event             TEXT    NOT NULL CHECK (event IN (
                      'migrate', 'snooze', 'recycle_duplicate', 'restore',
                      'shortcut_mapped', 'mail_share_link', 'mail_send_anyway')),
  count             INTEGER NOT NULL DEFAULT 0,
  mb_moved          REAL    NOT NULL DEFAULT 0,
  storage_freed_mb  REAL    NOT NULL DEFAULT 0,
  co2_low_g         REAL    NOT NULL DEFAULT 0,   -- yearly savings, lower bound
  co2_high_g        REAL    NOT NULL DEFAULT 0,   -- yearly savings, upper bound
  kwh_low           REAL    NOT NULL DEFAULT 0,
  kwh_high          REAL    NOT NULL DEFAULT 0,
  dc_kwh_low        REAL    NOT NULL DEFAULT 0,   -- part of kWh that is data-centre energy (incl. cooling)
  dc_kwh_high       REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (day, department, team_site_id, event)
);

-- Monthly mail-attachment metadata per department: sizes and recipient
-- COUNTS only. No senders, recipients, subjects or file names.
CREATE TABLE IF NOT EXISTS mail_attachment_stats (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  department       TEXT    NOT NULL,
  month            TEXT    NOT NULL,              -- 'YYYY-MM'
  size_mb          REAL    NOT NULL CHECK (size_mb >= 0),
  recipient_count  INTEGER NOT NULL CHECK (recipient_count >= 1)
);

-- --- (d) Model parameters ------------------------------------------------------------

-- Verified, conservative CO2 coefficients. Every coefficient is a band
-- (low..high) so the engine can report honest ranges instead of fake precision.
CREATE TABLE IF NOT EXISTS co2_metrics (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  value_low   REAL NOT NULL,
  value_high  REAL NOT NULL,
  unit        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('input', 'derived', 'behaviour', 'metaphor')),
  derivation  TEXT NOT NULL,
  source      TEXT NOT NULL,
  CHECK (value_low <= value_high)
);

-- --- Indexes -------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_files_owner_location ON files (owner_id, current_location, status);
CREATE INDEX IF NOT EXISTS idx_files_hash           ON files (content_hash, status);
CREATE INDEX IF NOT EXISTS idx_files_sp_folder      ON files (sharepoint_folder_id);
CREATE INDEX IF NOT EXISTS idx_onedrive_owner       ON onedrive_items (owner_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_migration_log_user   ON migration_log (user_id, at);
CREATE INDEX IF NOT EXISTS idx_memberships_site     ON site_memberships (site_id);
