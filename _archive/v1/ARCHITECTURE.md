# Architecture: Klimaattool (Data Lifecycle & Carbon Reduction Tool)

This document describes how the proof of concept is built: the components, the REST API, the database schema and the CO2 calculation model. Setup instructions are in [README.md](README.md).

---

## 1. System overview

The tool runs completely on one isolated virtual machine. Microsoft 365 is **simulated**: no request ever leaves the VM, and the real Microsoft Graph API is never contacted.

```
┌─────────────────────────────── Virtual Machine ───────────────────────────────┐
│                                                                               │
│   Browser                                                                     │
│   ┌──────────────────────────┐   ┌──────────────────────────────┐             │
│   │ Desktop widget           │   │ Teams dashboard tab          │             │
│   │ index.html + widget.js   │◄─►│ dashboard.html + dashboard.js│             │
│   └────────────┬─────────────┘   └──────────────┬───────────────┘             │
│                │  BroadcastChannel ("migrated") │                             │
│                └───────────────┬────────────────┘                             │
│                                │ HTTP (same origin), relative /api/* URLs     │
│                                ▼                                              │
│   ┌──────────────────────────────────────────────┐                            │
│   │ Frontend server  :3000   (frontend/server.js)│                            │
│   │  • serves frontend/public (static)           │                            │
│   │  • proxies /api/*  ──────────────────────────┼──┐                         │
│   └──────────────────────────────────────────────┘  │                         │
│                                                     ▼                         │
│   ┌───────────────────────────────────────────────────────────────┐           │
│   │ Backend "M365 Cloud Simulation"  127.0.0.1:3001 (Express 5)   │           │
│   │   routes/      HTTP ⇄ validation ⇄ status codes               │           │
│   │   services/    fileService · statsService · co2Calculator     │           │
│   │   db/          node:sqlite connection, schema, seed           │           │
│   └───────────────────────────────┬───────────────────────────────┘           │
│                                   ▼                                           │
│                    data/m365-mock.db  (SQLite: "Graph Mock Database")         │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Technology choices

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node.js ≥ 22.13 (ES modules) | One language (JavaScript) for the whole stack |
| HTTP framework | Express 5 | Small and well known. Errors in route handlers reach the error middleware automatically |
| Database | SQLite via the built-in `node:sqlite` module | Zero-install, single file. No native driver to compile on the VM |
| Frontend | Plain HTML, CSS and ES-module JavaScript | No build step, no CDN, so it works offline on an isolated VM |
| Tests | Built-in `node:test` runner | No test dependencies |

The only runtime dependency is `express`.

### Layering (backend)

```
routes/*.js      → parse and validate HTTP input, choose status codes
services/*.js    → business rules (eligibility, ownership, snooze, aggregation)
co2Calculator.js → pure maths, no I/O (unit-testable in isolation)
db/*.js          → connection, schema, transactions, seed data
```

Services are created by factory functions that receive the database connection (`createFileService(db)`). Because of this dependency injection, the test suite can run the real application against an in-memory database (`:memory:`).

---

## 2. REST API

Base URL: `http://127.0.0.1:3001/api` (directly), or `http://127.0.0.1:3000/api` (through the frontend proxy).
All responses are JSON. Errors always have this shape:

```json
{ "error": { "status": 409, "message": "Dit bestand staat al op SharePoint." } }
```

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | Liveness probe |
| GET  | `/api/users` | Simulated user directory (for the "signed-in user" selector) |
| GET  | `/api/files` | All drive items (inspection endpoint) |
| GET  | `/api/files/scan-onedrive` | **Migration candidates**: OneDrive files with `share_count > 2` |
| POST | `/api/files/migrate-to-sharepoint` | **Move a file** from OneDrive to SharePoint |
| POST | `/api/files/decline` | Log a **"Nu niet"** answer (nothing is moved) |
| GET  | `/api/stats/co2-saved` | **Total CO2 saved** (organisation, department, user) |

### 2.1 `GET /api/files/scan-onedrive`

| Query parameter | Required | Description |
|---|---|---|
| `user` | no | Only return files owned by this user (e.g. `u01`). Also hides files this user declined in the last 7 days. |
| `includeSnoozed` | no | `true` = also return recently declined files |

Results are sorted by projected CO2 saving, largest first, so the coach suggests the most valuable move first.

```json
{
  "threshold": 2,
  "user_id": "u01",
  "count": 6,
  "snoozed_count": 0,
  "total_potential_co2_grams_per_year": 414.14,
  "files": [
    {
      "id": 2,
      "filename": "Woningbouwprogramma_2026-2030.xlsx",
      "current_location": "OneDrive",
      "file_size_mb": 5.8,
      "share_count": 14,
      "last_accessed_date": "2026-11-02T17:25:29.467Z",
      "owner_department": "Wonen",
      "owner_user_id": "u01",
      "owner_name": "Sanne de Vries",
      "days_since_access": 1,
      "is_stale": false,
      "projected_savings": {
        "co2_grams_per_year": 14.93,
        "energy_kwh_per_year": 0.0498,
        "reduction_percent": 40.1,
        "breakdown": {
          "storage_co2_grams": 0.089,
          "network_co2_grams": 14.844,
          "onedrive_co2_grams": 37.23,
          "sharepoint_co2_grams": 22.29
        }
      }
    }
  ]
}
```

`is_stale` is `true` when a file has not been opened for more than 365 days. It is a data-lifecycle signal: such a file is also a candidate for archiving.

### 2.2 `POST /api/files/migrate-to-sharepoint`

Request body:

```json
{ "fileId": 2, "userId": "u01" }
```

`userId` is optional and defaults to the file's owner. The following happens in **one SQL transaction**:

1. `files.current_location` changes from `OneDrive` to `SharePoint` (guarded with `WHERE current_location = 'OneDrive'` against races).
2. A `migrations` row stores a snapshot of size, share count, kWh and CO2 saved.
3. A `coaching_decisions` row with `decision = 'migrated'` is written.

| Status | When |
|---|---|
| 200 | Migrated. The body contains `file`, `savings`, `migrated_by` and `migrated_at` |
| 400 | `fileId` missing or not a positive integer, or `userId` malformed |
| 403 | `userId` is not the owner. Nobody can move a file out of someone else's OneDrive |
| 404 | File or user does not exist |
| 409 | File is already on SharePoint |

### 2.3 `POST /api/files/decline`

Request body: `{ "fileId": 1, "userId": "u01" }`. This logs the "Nu niet" answer and returns **201**:

```json
{ "file_id": 1, "decision": "declined", "current_location": "OneDrive", "snoozed_until": "2026-11-10T17:25:29.496Z" }
```

The file is not touched. During the snooze window (7 days, `config.snoozeDays`) the scan for that user skips the file, so the coach never nags.

### 2.4 `GET /api/stats/co2-saved`

| Query parameter | Required | Description |
|---|---|---|
| `user` | no | Adds personal and department figures, coaching statistics and remaining potential |

```json
{
  "total":      { "files_migrated": 12, "mb_migrated": 393.9, "energy_kwh_saved_per_year": 2.32, "co2_grams_saved_per_year": 696, "equivalents": { … } },
  "departments": [ { "name": "Verkeer en Openbare Ruimte", "files_migrated": 2, "mb_migrated": 239.3, "co2_grams_saved_per_year": 279.5 }, … ],
  "user":       { "id": "u01", "display_name": "Sanne de Vries", "department": "Wonen", "files_migrated": 1, …, "equivalents": { … } },
  "department": { "name": "Wonen", "user_count": 2, "files_migrated": 3, … },
  "coaching":   { "accepted": 1, "declined": 1, "acceptance_rate_percent": 50 },
  "potential":  { "files_remaining": 6, "co2_grams_per_year": 414.14 },
  "recent_migrations": [ { "file_id": 10, "filename": "Woonwagenbeleid_nota.docx", … } ],
  "methodology": { "period": "per jaar", "co2_factors": { … }, "equivalence_factors": { … } }
}
```

`equivalents` contains `streetlight_hours`, `streetlight_nights`, `tree_days`, `trees_for_a_year` and `car_km_avoided` (section 4.5).

---

## 3. Database schema

The full DDL is in [backend/db/schema.sql](backend/db/schema.sql). It is applied idempotently (`CREATE TABLE IF NOT EXISTS`) on every start.

```
┌──────────────┐ 1      n ┌────────────────────┐ 1     0..1 ┌──────────────────┐
│ users        │──────────│ files              │────────────│ migrations       │
├──────────────┤  owns    ├────────────────────┤            ├──────────────────┤
│ id (PK)      │          │ id (PK)            │            │ id (PK)          │
│ display_name │          │ filename           │            │ file_id (FK, UQ) │
│ email (UQ)   │          │ current_location   │            │ migrated_by_…(FK)│
│ department   │          │ file_size_mb       │            │ department       │
└──────┬───────┘          │ share_count        │            │ file_size_mb     │
       │                  │ last_accessed_date │            │ share_count      │
       │                  │ owner_department   │            │ energy_kwh_…     │
       │                  │ owner_user_id (FK) │            │ co2_grams_…      │
       │                  └─────────┬──────────┘            │ migrated_at      │
       │ 1                        1 │                       └──────────────────┘
       │        n ┌──────────────────────┐ n
       └──────────│ coaching_decisions   │──┘
                  ├──────────────────────┤
                  │ id (PK)              │
                  │ file_id (FK)         │
                  │ user_id (FK)         │
                  │ decision             │  'migrated' | 'declined'
                  │ decided_at           │
                  └──────────────────────┘
```

### `files` (required by the brief, plus one extension)

| Column | Type | Constraint | Meaning |
|---|---|---|---|
| `id` | INTEGER | PK, autoincrement | Drive item id |
| `filename` | TEXT | NOT NULL | e.g. `Beleidsplan_Wonen_v2.docx` |
| `current_location` | TEXT | `CHECK IN ('OneDrive','SharePoint')` | Where the file lives |
| `file_size_mb` | REAL | `>= 0` | Size in megabytes |
| `share_count` | INTEGER | `>= 0` | Number of people with access |
| `last_accessed_date` | TEXT | ISO-8601 UTC | Last time the file was opened |
| `owner_department` | TEXT | NOT NULL | Department of the owner |
| `owner_user_id` | TEXT | FK → `users.id` | *Extension:* needed for per-user statistics and the ownership check |

### `migrations`

One row per completed move (`file_id` is UNIQUE). Size, share count, kWh and CO2 are **snapshots** taken at migration time. Historical results therefore stay stable even if a file changes later or the coefficients are recalibrated, which gives an audit trail. Statistics are `SUM`s over this table.

### `coaching_decisions`

This table is an append-only log of every answer to a notification. It supports user autonomy: it is the source of the 7-day snooze and of the "Jouw keuzes" statistic on the dashboard.

### Indexes

| Index | Supports |
|---|---|
| `idx_files_location_shares (current_location, share_count)` | The scan query |
| `idx_files_owner`, `idx_migrations_user`, `idx_migrations_department` | Per-user and per-department statistics |
| `idx_decisions_lookup (user_id, file_id, decision, decided_at)` | Snooze lookup |

### Seed data

[backend/db/seedData.js](backend/db/seedData.js) contains **65 fictional files** for **12 fictional users** in 8 departments (e-mail addresses use the reserved `.example` domain). The data includes:

- 40 migration candidates (OneDrive, `share_count > 2`);
- files that do not qualify (shared with 0 to 2 people, or already on SharePoint);
- 12 historical migrations, so the dashboard is not empty on first start;
- large media files (`.mp4`, `.zip`) and stale files (> 365 days) to show the lifecycle signal.

Dates are stored as "days ago" and converted at seed time, so the demo always looks current.

---

## 4. CO2 calculation logic

Implementation: [backend/services/co2Calculator.js](backend/services/co2Calculator.js). It consists of pure functions, unit-tested in [tests/co2Calculator.test.js](tests/co2Calculator.test.js).

### 4.1 Principle

For every file the engine computes the **annual** energy use in two situations, *file in OneDrive* and *file on SharePoint*. The saving of a migration is the difference. All dashboard figures are therefore **savings per year**: what the organisation avoids every year that the file stays on SharePoint.

### 4.2 Coefficients

| Constant | Value | Source / rationale |
|---|---|---|
| `STORAGE_KWH_PER_GB_YEAR` | **0.015** kWh/GB/yr | Given in the brief. Covers 24/7 storage including cooling (PUE) |
| `GRID_EMISSION_FACTOR_G_PER_KWH` | **300** g CO2e/kWh | Rounded location-based value for the Dutch electricity mix. Recent years range roughly from 250 to 400 g/kWh, decreasing as renewables grow |
| `NETWORK_KWH_PER_GB` | **0.03** kWh/GB | Mid-range of published estimates for fixed networks (roughly 0.005 to 0.06 kWh/GB depending on year and method, cf. the declining trend in Aslan et al., 2018) |
| `SYNC_CYCLES_PER_YEAR` | **52** | Assumption: each collaborator's client re-syncs the full file about once a week because it changed |
| `SHAREPOINT_SYNC_REDUCTION` | **0.40** | Given in the brief: centralised delta-sync cuts active sync traffic by 40 % |
| `ONEDRIVE_DUPLICATE_COPY_RATIO` | **0.25** | Assumption: a quarter of collaborators keep a redundant copy when a file is shared from a personal OneDrive (save-a-copy, e-mail attachment, re-upload). SharePoint has a single source of truth |

All coefficients are named constants in one frozen object. Every function accepts an override object, so scenario analysis is a one-liner (see the "conservative scenario" test, which sets the duplicate ratio to 0).

### 4.3 Formulas

With `size_gb = file_size_mb / 1024` and `n = share_count`:

**(1) Storage impact**

```
copies_OneDrive   = 1 + DUPLICATE_COPY_RATIO × n
copies_SharePoint = 1
storage_kWh       = size_gb × copies × STORAGE_KWH_PER_GB_YEAR
```

**(2) Network sync impact**

```
sync_GB_OneDrive   = size_gb × n × SYNC_CYCLES_PER_YEAR
sync_GB_SharePoint = sync_GB_OneDrive × (1 − SHAREPOINT_SYNC_REDUCTION)
network_kWh        = sync_GB × NETWORK_KWH_PER_GB
```

**(3) Emissions**

```
CO2_g = (storage_kWh + network_kWh) × GRID_EMISSION_FACTOR_G_PER_KWH
```

**(4) Saving**

```
saved_g           = CO2_g(OneDrive) − CO2_g(SharePoint)
reduction_percent = saved_g / CO2_g(OneDrive) × 100        (0 when CO2_g(OneDrive) = 0)
```

### 4.4 Worked example

`Woningbouwprogramma_2026-2030.xlsx`: 5.8 MB, shared with 14 people.

| Step | OneDrive | SharePoint | Saved |
|---|---|---|---|
| size_gb | 0.005664 | 0.005664 | |
| storage copies | 1 + 0.25 × 14 = **4.5** | **1** | |
| storage kWh | 0.005664 × 4.5 × 0.015 = 0.000382 | 0.000085 | 0.000297 |
| sync volume | 0.005664 × 14 × 52 = **4.123 GB** | × 0.6 = **2.474 GB** | |
| network kWh | 4.123 × 0.03 = 0.12370 | 0.07422 | 0.04948 |
| total kWh | 0.12409 | 0.07431 | **0.04978** |
| CO2 (× 300 g/kWh) | **37.23 g** | **22.29 g** | **14.93 g/yr (−40.1 %)** |

The network term dominates. The reduction is therefore just above the 40 % sync reduction, and the storage term adds the extra 0.1 %.

### 4.5 Amsterdam equivalents (positive reinforcement)

| Equivalent | Formula | Coefficient |
|---|---|---|
| 🏮 Canal lantern burning time | `kWh × 1000 / 40 W` hours, ÷ 11.2 h for nights | LED canal lantern ≈ 40 W, about 4,100 burning hours per year |
| 🌳 Vondelpark tree absorption time | `g / (22,000 g / 365)` days | A mature city tree absorbs about 22 kg CO2 per year |
| 🚲 Car kilometres avoided | `g / 150 g/km` | Indicative real-world emissions of an average petrol car |

The frontend picks a readable unit automatically (minutes, hours, nights, days; metres, km), so a small personal saving still reads as a concrete result instead of "0".

### 4.6 Limitations (stated for academic honesty)

- The coefficients are **assumptions**, not measurements. Real values depend on the data centre, the network path and the time of day. The model shows relative effects; it is not a carbon accounting tool.
- Sync behaviour is modelled as full-file re-syncs at a fixed frequency. In reality, edit frequency differs per file (a final PDF changes less often than a working spreadsheet). A next iteration could weight `SYNC_CYCLES_PER_YEAR` by `last_accessed_date`.
- Embodied emissions of hardware and end-user devices are out of scope.
- Savings are snapshotted at migration time. Changing a coefficient affects new migrations only (by design, for the audit trail).

---

## 5. Frontend design

### 5.1 Desktop widget (`index.html`, `widget.js`)

| Requirement | Implementation |
|---|---|
| Trigger on startup | `scan()` calls `GET /api/files/scan-onedrive?user=…` and shows the first card after 0.9 s |
| Persona and copy | The exact Dutch text from the brief, in a `<template>`. One card at a time, with a counter ("1 van 6") |
| "Ja, verhuis het" | `POST migrate-to-sharepoint`. The card changes to `data-state="done"` with an animated green SVG checkmark and the actual saving, then moves to the next suggestion after 2.6 s |
| "Nu niet" | `POST decline`. The card closes **even if logging fails**, because the user's choice always wins. A toast confirms that the file stays in OneDrive and until when it is snoozed |
| Non-intrusive | No `focus()` stealing, `aria-live="polite"`, minimise button and Esc key, a tray icon with badge to reopen later |

### 5.2 Teams dashboard (`dashboard.html`, `dashboard.js`)

- **KPI tiles**: MB migrated (you), CO2 saved by you, by your department and by the whole municipality.
- **Amsterdam metaphors**, switchable between Jij, Afdeling and Gemeente.
- **Department ranking**: horizontal bars from one baseline, with the user's department highlighted. It has a hover/focus tooltip and a table view that is accessible with the keyboard.
- **Jouw keuzes**: accepted vs. declined count, remaining potential and recent migrations.
- **Berekening tab**: shows the live coefficients from the API, so the documentation and the code cannot drift apart.
- Live updates via `BroadcastChannel` (instant when the widget migrates a file), on tab focus and every 30 s.

### 5.3 Theming and accessibility

Colours are CSS custom properties with a light and a dark set (it follows the OS setting). The data colours come from a colour-vision-deficiency-validated palette. All dynamic text is inserted with `textContent` (no `innerHTML`), so file names cannot inject markup. Tabs, the radio group and the chart rows are usable with the keyboard, and `prefers-reduced-motion` disables animations.

---

## 6. Security and compliance

| Requirement | Measure |
|---|---|
| No connection to real Microsoft Graph or production | No outbound HTTP code exists. The frontend CSP sets `connect-src 'self'` and all assets are self-hosted |
| No access to the VM's local disk | The backend only opens `data/m365-mock.db`. No endpoint accepts file paths. The static server only serves `frontend/public` (dotfiles ignored, traversal returns 404) |
| Network exposure | Both servers bind to `127.0.0.1` by default |
| Input validation | Ids are validated (positive int, user id regex). All SQL is parameterised (prepared statements). The JSON body limit is 10 kB |
| Authorisation (simulated) | Only the owner can migrate a file (403 otherwise) |
| Error hygiene | The central error handler returns generic 500 messages, and stack traces stay in the server log |
| Headers | `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, a strict CSP |
| Privacy of demo data | All people are fictional, and e-mail addresses use the reserved `.example` domain |

The "signed-in user" is chosen with a dropdown that is clearly marked as **Simulatie**. A production version would take the identity from the Teams/Entra ID SSO token instead.

---

## 7. Testing

`npm test` runs 20 tests with the built-in Node test runner:

- **Unit** ([tests/co2Calculator.test.js](tests/co2Calculator.test.js)): the formulas against hand-calculated values, the 40 % reduction, zero/edge cases, input validation, coefficient overrides and the equivalents.
- **Integration** ([tests/api.test.js](tests/api.test.js)): the real Express app with a seeded in-memory DB over HTTP. It covers scan filtering and ranking, migration including the statistics update, 409/403/404/400 handling, decline plus snooze, and stats shape.

---

## 8. Path to production (out of scope for the PoC)

| PoC component | Production counterpart |
|---|---|
| SQLite mock tables | Microsoft Graph: `/me/drive/root/children`, `/drives/{id}/items/{id}/permissions` |
| `POST migrate-to-sharepoint` | Graph `move`/`copy` of the drive item to a SharePoint document library |
| User dropdown | Teams SSO (`@microsoft/teams-js`) with an Entra ID token (on-behalf-of flow) |
| Desktop widget page | An Electron/WebView2 tray app or an Outlook/Teams notification |
| Teams dashboard page | A Teams personal tab (app manifest) hosting the same page |
