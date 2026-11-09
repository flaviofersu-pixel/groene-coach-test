-- =============================================================================
-- schema.sql — "Microsoft Graph Mock Database"
--
-- A deliberately small relational model that mimics the parts of Microsoft 365
-- (users, OneDrive/SharePoint drive items, sharing) that the Klimaattool needs.
-- All statements are idempotent (IF NOT EXISTS) so the schema can be applied on
-- every server start without destroying data.
-- =============================================================================

-- Simulated Entra ID (Azure AD) user directory.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,               -- e.g. 'u01'
  display_name  TEXT NOT NULL,                  -- 'Sanne de Vries'
  email         TEXT NOT NULL UNIQUE,           -- fictional *.example address
  department    TEXT NOT NULL                   -- organisational unit
);

-- Simulated drive items. Columns required by the brief come first.
CREATE TABLE IF NOT EXISTS files (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  filename            TEXT    NOT NULL,
  current_location    TEXT    NOT NULL
                      CHECK (current_location IN ('OneDrive', 'SharePoint')),
  file_size_mb        REAL    NOT NULL CHECK (file_size_mb >= 0),
  share_count         INTEGER NOT NULL DEFAULT 0 CHECK (share_count >= 0),
  last_accessed_date  TEXT    NOT NULL,         -- ISO-8601 timestamp (UTC)
  owner_department    TEXT    NOT NULL,
  -- Extension: who owns the item, needed for per-user statistics and to make
  -- sure only the owner can move a file out of their personal OneDrive.
  owner_user_id       TEXT    NOT NULL REFERENCES users(id)
);

-- One row per completed OneDrive -> SharePoint move.
-- Size, share count and CO2 values are SNAPSHOTS taken at migration time, so
-- historical results stay stable (audit trail) even if a file changes later.
CREATE TABLE IF NOT EXISTS migrations (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id                     INTEGER NOT NULL UNIQUE REFERENCES files(id),
  migrated_by_user_id         TEXT    NOT NULL REFERENCES users(id),
  department                  TEXT    NOT NULL,
  file_size_mb                REAL    NOT NULL,
  share_count                 INTEGER NOT NULL,
  energy_kwh_saved_per_year   REAL    NOT NULL,
  co2_grams_saved_per_year    REAL    NOT NULL,
  migrated_at                 TEXT    NOT NULL  -- ISO-8601 timestamp (UTC)
);

-- Audit log of every answer given to a coaching notification.
-- 'migrated' = "Ja, verhuis het", 'declined' = "Nu niet".
CREATE TABLE IF NOT EXISTS coaching_decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES files(id),
  user_id     TEXT    NOT NULL REFERENCES users(id),
  decision    TEXT    NOT NULL CHECK (decision IN ('migrated', 'declined')),
  decided_at  TEXT    NOT NULL                  -- ISO-8601 timestamp (UTC)
);

-- Indexes for the hot query paths (scan + statistics).
CREATE INDEX IF NOT EXISTS idx_files_location_shares ON files (current_location, share_count);
CREATE INDEX IF NOT EXISTS idx_files_owner           ON files (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_migrations_user       ON migrations (migrated_by_user_id);
CREATE INDEX IF NOT EXISTS idx_migrations_department ON migrations (department);
CREATE INDEX IF NOT EXISTS idx_decisions_lookup      ON coaching_decisions (user_id, file_id, decision, decided_at);
