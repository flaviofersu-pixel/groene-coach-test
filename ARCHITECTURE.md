# Architecture: Groene Coach (v2 "From Insight to Action")

*Data Lifecycle & Carbon Reduction Tool: proof of concept for a simulated Gemeente Amsterdam Microsoft 365 tenant.*

**Audience:** CISO, Privacy Officer (FG/DPO), Information Management (Archiefwet) and the academic assessors.
**Status:** proof of concept on an isolated VM. Microsoft 365 is simulated; no real tenant, user or file is touched.

---

## 0. Summary for decision makers

| Question | Answer |
|---|---|
| What does it do? | It coaches civil servants to move heavily shared files from their personal OneDrive to the department's SharePoint site, to clean up identical copies, and to share links instead of mailing large attachments. |
| What is installed on laptops? | **Nothing.** It is a Microsoft Teams web app plus an Outlook event-based add-in (Smart Alert). No desktop software, no Windows Explorer modification. |
| Can it delete data? | **No.** No code path hard-deletes a file, and a database trigger blocks it. Identical copies can go to the recycle bin (restorable for 93 days), but only after the user explicitly confirms. |
| Who decides? | Always the civil servant. Every action needs a click. "Nu niet" is honoured immediately, and Outlook always offers "Toch verzenden". |
| Which Graph permission is sensitive? | `Files.ReadWrite.All` (delegated). The tenant requires **admin consent** for it. The app only acts *as the signed-in user* and therefore never gets more access than that user already has. |
| What personal data is processed? | File metadata of the user's own OneDrive, a 7-day "Nu niet" marker and a personal action log (365 days) that only the user can see. Organisation figures are **aggregated per department, without user ids**, with a minimum group size of 3. |
| Is the CO2 claim honest? | Yes, by design. It uses the updated Dutch grid mix (0.268 kg/kWh), 0.65 W/TB and a PUE of 1.185, and all results are ranges. A single move is reported as **0 bytes of storage saved**. |

---

## 1. System context

```
 Civil servant's locked laptop (nothing installed)
 ┌───────────────────────────────────────────────┐
 │ Microsoft Teams ── personal app "Groene Coach" │──┐
 │ Outlook ── OnMessageSend add-in (Smart Alert)  │──┤  HTTPS, Bearer token (Teams/Entra SSO)
 └───────────────────────────────────────────────┘  │
                                                    ▼
 ┌──────────────────────────── Municipal hosting (in this PoC: one VM) ───────────────────────────┐
 │  Frontend server :3000  (static files + /api reverse proxy, strict CSP)                        │
 │        │                                                                                       │
 │        ▼                                                                                       │
 │  Backend API 127.0.0.1:3001 (Node.js / Express 5)                                              │
 │    middleware   security headers · path-only logging · token validation (requireAuth)          │
 │    routes       thin controllers: validate input, pick status codes                            │
 │    services     actionHub · user (SharePoint Mapper) · outlook · impact · telemetry · retention │
 │    co2Calculator pure functions, coefficients injected from co2_metrics                        │
 │    graphMock    ◄── the ONLY component that touches drive data; enforces Graph scopes          │
 │        │                 (production: replaced by a Microsoft Graph client using an OBO token) │
 │        ▼                                                                                       │
 │  SQLite "tenant simulation" data/m365-tenant-sim.db                                            │
 └────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Design patterns used

| Pattern | Where | Why |
|---|---|---|
| **Composition root / dependency injection** | `backend/app.js` | Services get the db, gateway, clock and coefficients as parameters. Tests inject an in-memory DB and a fixed clock. |
| **Gateway / anti-corruption layer** | `backend/graph/graphMock.js` | One boundary that mirrors Microsoft Graph endpoints and enforces scopes and ownership. Swapping it for a real Graph client is the production step. |
| **Thin controller** | `backend/routes/*` | HTTP concerns only. Business rules live in services. |
| **Pure functional core** | `backend/services/co2Calculator.js` | No I/O, no clock, so it is deterministic and unit-testable. |
| **Unit of work** | `inTransaction()` | Drive change, personal audit row and aggregated telemetry are committed together or not at all. |
| **Privacy by design (aggregate on write)** | `services/telemetry.js` | The telemetry API cannot accept a user id, so personal data cannot leak into it by accident. |
| **Chain of responsibility** | Express middleware | Headers → logging → JSON parsing → auth → route → error handler. |
| **View modules** (frontend) | `frontend/public/js/*.js` | Each Teams tab is a module with `load()`. The shell handles sign-in, tabs and refreshes. |

---

## 2. Permission architecture (Microsoft Graph)

### 2.1 Required delegated permissions

| Scope | Used for | Consent |
|---|---|---|
| `User.Read` | Name and department of the signed-in user | User-consentable |
| `Files.Read.All` | Reading the user's OneDrive items, sharing permissions and `quickXorHash` (duplicate detection) | Admin consent in this tenant |
| **`Files.ReadWrite.All`** | **Moving** an item from the personal OneDrive into a SharePoint library (a write across two drives), adding a **shortcut** to the OneDrive root, moving an identical copy to the **recycle bin** | **Admin consent required** in this tenant |
| `Sites.Read.All` | Listing the SharePoint sites the user is a member of | Admin consent in this tenant |

**Why `Files.ReadWrite.All`?** `Files.ReadWrite` only covers the user's own OneDrive. A move into a department library writes to *another* drive, and adding a `remoteItem` shortcut that points at a site library has the same requirement. That is why the `.All` variant is needed.

**Why admin consent?** Microsoft lets users consent to some delegated `.All` scopes themselves, but a municipality disables user consent for applications (tenant setting, in line with Microsoft's and the BIO's guidance). An administrator therefore grants consent once for the whole organisation, after review by the CISO. No individual civil servant is ever asked to approve broad file access.

**Delegated, not application permissions.** The app always acts *on behalf of* the signed-in user, so Graph enforces that user's own SharePoint and OneDrive permissions on every call. Application permissions (a daemon with tenant-wide access) are deliberately **not** requested. A compromised backend therefore cannot read or move files of users who are not actively using the app.

**Further hardening (recommended for production):** evaluate Microsoft Graph's resource-specific "Selected" permissions (for example `Sites.Selected`) to limit write access to department sites only. Use Conditional Access to restrict the app to managed devices.

### 2.2 How the PoC enforces this

- The simulated SSO token carries the granted scopes in `scp`. Without admin consent (`ADMIN_CONSENT=false`), only `User.Read` is present.
- Every method in `graphMock.js` calls `requireScope(actor, scope)` first, then checks **ownership** (you can only manage your own OneDrive) and **site membership** (you can only move into, or add a shortcut to, sites you belong to).
- The test suite has a separate scenario without admin consent: every file operation returns **403** with an explanation, and the UI shows a banner.

### 2.3 Secure token handling

**Production flow (Teams SSO + On-Behalf-Of):**

```
Teams client ──getAuthToken()──► SSO token (aud = api://groenecoach, scp = access_as_user)
     │
     └─ Authorization: Bearer <SSO token> ─► Backend
                                              1. validate: signature (Entra JWKS), iss, aud, exp/nbf,
                                                 tid = Amsterdam tenant, scp
                                              2. MSAL ConfidentialClient.acquireTokenOnBehalfOf()
                                                 → Graph access token (delegated, user-scoped)
                                              3. call Graph; cache token in MEMORY, partitioned per user
```

| Measure | Detail |
|---|---|
| Graph tokens never reach the browser | The OBO exchange happens server-side. The browser only holds the SSO token for *our* API. |
| No persistence | The token cache is in-memory only, partitioned per user (`oid` + `tid`). Tokens are never written to the database or disk. |
| No logging | The request logger writes `METHOD /path -> status` only: no query string, no headers, no bodies. |
| Client credential | A certificate in Azure Key Vault (preferred over a client secret), with rotation. |
| Short lifetimes | Graph access tokens are short-lived and refreshed via OBO. Continuous Access Evaluation (CAE) revokes them when a user is disabled. |
| Transport | TLS only. The API is not reachable from the internet directly (reverse proxy / App Gateway). |

**PoC equivalent (no Microsoft connection allowed):** `backend/auth/tokenService.js` issues HMAC-SHA256-signed JWT-style tokens. The secret is random at start-up and held in memory, or comes from `TOKEN_SIGNING_SECRET`. Tokens last 15 minutes. Verification uses a constant-time signature compare and rejects `alg` downgrades and wrong `iss`, `aud` or expired `exp`. Identity is **always** taken from the validated token, never from the request body. The frontend keeps the token in a JavaScript variable (not `localStorage`) and silently signs in again on expiry. The `simulated-sso` endpoint exists only for the demo and is switched off with `ENABLE_SIMULATED_SSO=false`.

---

## 3. Privacy (AVG/GDPR)

### 3.1 Data inventory

| Data | Personal? | Purpose | Retention | Who can see it |
|---|---|---|---|---|
| File metadata of own OneDrive (name, size, share count, modified date, hash) | Yes (work context) | Coaching suggestions | Not stored by the tool. Read live from Graph (simulated here) | Only the user |
| `snoozes` ("Nu niet") | Yes | Not asking again for 7 days | **Deleted when it expires** (hourly retention job) | Nobody (functional) |
| `migration_log` (own actions) | Yes | "Jouw bijdrage", undo, accountability | **365 days**, then purged | **Only the user themselves** (token subject). No endpoint queries another person. |
| `telemetry_daily` | **No**: per day × department × event type | Organisation and department impact | Indefinite (anonymous) | Everyone in the dashboard |
| `mail_attachment_stats` | **No**: department, month, size, recipient *count* | Cumulative cloning waste | Indefinite (anonymous) | Everyone in the dashboard |
| E-mail recipients, subject, body | Never processed | – | – | – |
| File contents | Never processed | – | – | – |

### 3.2 Principles applied

- **Data minimisation (art. 5(1)(c)).** The Smart Alert receives attachment ids and a recipient **count**. No addresses, subject or body. Duplicate detection uses the content hash Graph already computes; contents are never read.
- **Aggregation on write.** `telemetry.record()` has no user parameter. One counter row per day × department × event is incremented, and organisation and department dashboards read only these rows.
- **k-anonymity (minimum group size 3).** A department is only shown when it has at least 3 members. Smaller units are merged into "Overige afdelingen". The demo data has 3 users per department to show this.
- **No profiling or ranking of individuals.** There is no leaderboard of people and no manager view of individuals. Colleagues who hold a duplicate are shown as a **count** ("2 collega's"), never by name.
- **Storage limitation (art. 5(1)(e)).** `services/retention.js` purges expired snoozes and audit rows older than 365 days, at start-up and every hour.
- **Transparency.** The "Privacy & berekening" tab explains all of the above in plain Dutch, and shows the granted Graph scopes and the CO2 coefficients.
- **Legal basis.** Public task / legitimate organisational interest in sustainable and lawful information management (art. 6(1)(e)), to be confirmed by the Privacy Officer.
- **Recommended before production:** a DPIA (the tool observes work behaviour), and consent from the **works council (OR)**, since tools that can monitor employee behaviour fall under WOR art. 27. The aggregated design is meant to make both straightforward.

---

## 4. Archiefwet compliance

**The problem.** Records (*archiefbescheiden*) that live in a personal OneDrive are outside the department's retention regime. When an employee leaves, the OneDrive is eventually removed, and records can be lost or destroyed outside the municipality's *selectielijst*. SharePoint team sites are where retention labels and policies of the department apply.

**How the Groene Coach helps.**

1. **It moves records to the legally correct place.** The nudge literally says: *"Zo staat het direct op de wettelijk juiste plek voor de Archiefwet."* By default, files move to the user's **department site**, into a clearly named folder "Verhuisd vanuit OneDrive".
2. **It never deletes.**
   - No hard-delete method exists in the Graph gateway.
   - A database trigger (`trg_files_never_delete`) aborts any `DELETE FROM files` with the message *"Archiefwet: drive items are never hard-deleted"*, and a test proves it.
   - Clean-up applies only to **bit-identical** copies (same `quickXorHash`), only to the user's **own** copies, and only after an explicit confirmation dialog (`confirmed: true` is required by the API; 400 otherwise).
   - Those copies go to the **recycle bin** (restorable for 93 days in M365). The UI offers "Ongedaan maken", and `POST /api/files/:id/restore` puts them back.
   - Before any copy is recycled, a master copy must exist on SharePoint. If there is none, the user's newest copy is moved there first. The record itself, including version history, is therefore always preserved.
3. **Colleagues' data is never touched.** Their copies stay where they are; the user only sees a count.
4. **Accountability.** Every action writes a personal audit row (who, what, from where, to where, when). In production, Microsoft Purview's unified audit log also records the Graph operations.

---

## 5. CO2 calculation model (honest Green IT)

Implementation: [backend/services/co2Calculator.js](backend/services/co2Calculator.js). Coefficients are stored in the `co2_metrics` table and seeded from [backend/db/seedData.js](backend/db/seedData.js).

### 5.1 Principles

1. **Ranges, not fake precision.** Every coefficient has a low and a high value, so every result is a band. Bands are rounded **outward** (the lower bound down, the upper bound up), so they never become narrower than the maths. Example: *"0,4 – 9 gram CO₂ per jaar"*, never "4.12 gram".
2. **A single move saves 0 bytes of storage.** Moving a file relocates the same bytes. It only saves **sync traffic** and **backup overhead**. The UI says this explicitly in the nudge details and in the confirmation.
3. **Storage savings only come from breaking duplicate chains** (recycling identical copies) and from **links instead of attachments** (clones that never get created).
4. **Outdated high factors abandoned.** The model uses the updated Dutch grid mix and conservative network factors.

### 5.2 Coefficients (`co2_metrics`)

| Key | Low | High | Unit | Source |
|---|---|---|---|---|
| `grid_emission_factor` | 268 | 268 | g CO2/kWh | Brief v2: updated Dutch grid mix (0.268 kg/kWh) |
| `storage_power_w_per_tb` | 0.65 | 0.65 | W/TB | Brief v2 |
| `pue` | 1.185 | 1.185 | – | Brief v2 |
| `storage_replication_factor` | 1 | 2 | replicas | PoC assumption (geo-redundant pair as upper bound) |
| **`storage_g_per_gb_year`** (derived) | **1.808** | **3.617** | g CO2/GB/yr | 0.65 W/TB × 8760 h ÷ 1000 GB/TB ÷ 1000 × 1.185 × replicas × 268 g/kWh (≈ **3.6 g** upper bound) |
| `network_energy_kwh_per_gb` | 0.006 | 0.015 | kWh/GB | Conservative band from recent fixed-network estimates |
| **`network_sync_g_per_gb`** (derived) | **1.608** | **4.02** | g CO2/GB | network energy × 268 |
| `edit_cycles_active` | 12 | 52 | per year | Monthly to weekly new versions (file modified ≤ 90 days ago) |
| `edit_cycles_dormant` | 0 | 4 | per year | File not modified for > 90 days |
| `active_window_days` | 90 | 90 | days | |
| `delta_sync_reduction` | 0.30 | 0.50 | fraction | One central library with delta-sync instead of per-share syncing |
| `backup_dedup_reduction` | 0 | 0.30 | fraction | Site-level backup deduplicates versions. **Lower bound 0**: if the backup tool already deduplicates, there is no gain |
| `mail_copies_per_recipient` | 1 | 1 | copy | Rick van Kersbergen rule |
| `canal_lamp_power_w` | 40 | 40 | W | LED canal lamp, for the metaphor |

The engine **recomputes** the derived rows from the inputs, and a unit test asserts that the stored values match. The table therefore cannot silently drift from the code. `GET /api/co2-metrics` returns the table plus the engine's own check.

### 5.3 Formulas

With `size_GB = size_mb / 1024`, `n = times_shared` and `cycles` the edit band (active or dormant):

**Scenario 1: move one file (OneDrive → SharePoint)**

```
storage saved   = 0                                     (same bytes, different place)
sync_saved_GB   = size_GB × n × cycles × delta_sync_reduction
sync_kWh        = sync_saved_GB × network_energy_kwh_per_gb
backup_saved_GB = size_GB × cycles × backup_dedup_reduction
backup_kWh      = backup_saved_GB × (network_energy_kwh_per_gb + storage_kWh_per_GB_year)
CO2_g           = (sync_kWh + backup_kWh) × 268
```

**Scenario 2: break a duplicate chain (recycle k identical copies)**

```
freed_GB = size_GB × k
CO2_g    = freed_GB × storage_g_per_gb_year          (per year)
```

**Scenario 3: e-mail attachment cloning (Rick van Kersbergen rule)**

```
copies         = recipients × 1                       (1 attachment to 20 people = 20× storage)
duplicate_GB   = size_GB × copies
annual CO2_g   = duplicate_GB × storage_g_per_gb_year (storing the clones, recurring)
one-off CO2_g  = duplicate_GB × network_sync_g_per_gb (delivering them once)
link instead   = 0 extra copies
```

The cumulative waste over the `mail_attachment_stats` history is the sum of scenario 3 over all rows. It is shown on the dashboard with the average amplification (≈ 23× in the demo data).

**Metaphors (realistic proportions)**

```
canal-lamp hours = kWh × 1000 / 40 W              ("X – Y lamps burning for one hour")
cooling kWh      = data-centre kWh × (PUE − 1) / PUE ≈ 15.6 %   (network energy excluded)
```

### 5.4 Worked example

`Woningbouwprogramma_2026-2030.xlsx`: 5.8 MB, shared with 14 people, modified yesterday (active).

| Step | Low | High |
|---|---|---|
| size_GB | 0.005664 | 0.005664 |
| sync_saved_GB = size × 14 × cycles × reduction | × 12 × 0.30 = 0.2855 | × 52 × 0.50 = 2.0617 |
| sync kWh | × 0.006 = 0.00171 | × 0.015 = 0.03093 |
| backup_saved_GB = size × cycles × dedup | × 12 × 0 = 0 | × 52 × 0.30 = 0.0884 |
| backup kWh | 0 | 0.0884 × (0.015 + 0.01349) = 0.00252 |
| total kWh | 0.00171 | 0.03344 |
| CO2 (× 268 g/kWh) | **0.46 g** | **8.96 g** |
| **Shown to the user** | **"0,4 – 9 gram CO₂ per jaar"**, storage: **0 gram** | |

Smart Alert example: a 48.5 MB presentation to 20 people → 970 MB of mailbox clones (20×), so **"1 – 4 gram CO₂ per jaar"** for storage, plus 1.5 – 3.8 g once for delivery.

### 5.5 Limitations (stated openly)

- The coefficients are assumptions for a PoC, not measurements. The bands are intentionally wide.
- Per file, the effect is small. The dashboard says so ("Eerlijk is eerlijk…"). The value lies in scale, less traffic, and records in the right place.
- Embodied emissions of hardware and end-user devices are out of scope.
- Savings are snapshotted at the time of the action (audit stability). New coefficients apply to new actions.

---

## 6. REST API

Base: `http://127.0.0.1:3001/api` (or via the proxy at `:3000/api`). Errors always look like `{ "error": { "status": 403, "message": "…" } }`.

| Method | Path | Auth | Graph scope | Purpose |
|---|---|---|---|---|
| GET | `/health` | – | – | Liveness |
| GET | `/co2-metrics` | – | – | Coefficient table plus engine check |
| GET | `/auth/simulated-users` | – (demo only) | – | User picker |
| POST | `/auth/simulated-sso` | – (demo only) | – | `{userId}` → 15-minute Bearer token |
| GET | `/user/me` | Bearer | `User.Read` | Profile, granted scopes, site memberships (+ `mapped`) |
| GET | `/files/scan-onedrive` | Bearer | `Files.Read.All` | **Feature A**: own OneDrive files with `times_shared > 2`, not snoozed, with a CO2 band and breakdown |
| GET | `/files/mine` | Bearer | `Files.Read.All` | Own active files (Outlook attachment picker) |
| GET | `/files/duplicate-chains` | Bearer | `Files.Read.All` | Identical-copy chains in which the user owns a copy |
| POST | `/files/migrate-to-sharepoint` | Bearer | **`Files.ReadWrite.All`** | `{fileId, siteId?}` → move to the (default: department) site |
| POST | `/files/snooze` | Bearer | `Files.Read.All` | `{fileId}` "Nu niet" → hidden for 7 days (201) |
| POST | `/files/consolidate-duplicates` | Bearer | **`Files.ReadWrite.All`** | `{contentHash, confirmed: true}` → own copies to the recycle bin |
| POST | `/files/:id/restore` | Bearer | **`Files.ReadWrite.All`** | Undo: recycle bin → OneDrive |
| POST | `/user/map-sharepoint-shortcut` | Bearer | **`Files.ReadWrite.All`** | `{siteId?}` → insert a SharePoint shortcut into the OneDrive root (201 created / 200 existing) |
| GET | `/user/explorer-view` | Bearer | `Files.Read.All` | Before/after trees for the Explorer preview |
| POST | `/outlook/evaluate-send` | Bearer | `Files.Read.All` | `{fileIds, recipientCount}` → alert decision, message, bands |
| POST | `/outlook/resolve` | Bearer | `Files.Read.All` | `{decision: share_link\|send_anyway\|cancel, …}` → aggregated telemetry, sharing links |
| GET | `/stats/impact` | Bearer | – | Personal (self only), department (k ≥ 3), organisation, cloning waste, metaphors |

**Status codes.** 400 invalid input (allow-list validators), 401 missing/invalid/expired token, 403 missing scope / not the owner / not a site member, 404 unknown item, 409 state conflict (already on SharePoint, nothing to clean up).

**Example: the SharePoint Mapper**

```http
POST /api/user/map-sharepoint-shortcut
Authorization: Bearer eyJ…
Content-Type: application/json

{}
```
```json
201 Created
{ "created": true,
  "shortcut": { "id": 60, "name": "Wonen - Documenten", "created_at": "2026-11-03T18:37:04Z" },
  "site": { "id": "s01", "display_name": "Wonen", "web_url": "https://amsterdam.sharepoint.example/sites/wonen" } }
```

Production equivalent: `POST /me/drive/root/children` with `{ "name": "Wonen - Documenten", "remoteItem": { "driveId": "<library>", "id": "<root>" } }`. This is OneDrive's standard "Add shortcut to My files". The library then appears in OneDrive on the web **and in Windows Explorer through the standard OneDrive sync client**, so nothing is installed or modified on the laptop.

---

## 7. Database schema

Full DDL: [backend/db/schema.sql](backend/db/schema.sql).

```
sharepoint_sites ◄──┐                 ┌─► sharepoint_folders ◄── files.sharepoint_folder_id
  id, display_name  │ site_memberships│     id, site_id, name
  department        ├─ user_id ───────┤
  web_url, library  │  site_id, role  │
                    │                 │
users ──────────────┘                 │
  id, display_name, email, department │
   │                                  │
   ├─► onedrive_items (OneDrive tree) │
   │     id, owner_id, parent_id      │
   │     item_type: folder | shortcut │
   │     target_site_id ──────────────┘   (shortcut = "SharePoint Shortcut Link Object")
   │       ▲
   │       └── files.onedrive_folder_id
   │
   ├─► files  id, filename, current_location, size_mb, owner_id, department,
   │          times_shared, last_modified, content_hash, status (active|recycled), recycled_at
   │          CHECK exactly one parent matching the location · TRIGGER: no DELETE
   │
   ├─► snoozes        (user_id, file_id, until)          functional, auto-purged
   └─► migration_log  own audit trail, 365-day retention

telemetry_daily        (day, department, event, counters, CO2/kWh bands)   NO user ids
mail_attachment_stats  (department, month, size_mb, recipient_count)       NO identities
co2_metrics            (key, label, value_low, value_high, unit, category, derivation, source)
```

**Seed data:** 18 fictional users (3 per department, so k-anonymity holds), 7 SharePoint sites (6 departments plus the cross-department "Programma Groene ICT", showing the many-to-many relation), 66 files including **5 duplicate chains** (for example `Actieplan_Groene_ICT_v1_concept.docx` and its "Kopie van …" and "(1)" variants, and `Subsidie_Aanvraag_Parkeren.xlsx`), 10 historical migrations, 5 existing shortcuts, and 19 rows of aggregated mail metadata.

---

## 8. Frontend

| Page | Simulates | Key behaviour |
|---|---|---|
| `index.html` | Teams personal app "Groene Coach" | **Actie-hub**: the nudge with the exact copy *"Samen groener werken, [Naam]? 🌿 …"*, Ja/Nu niet, a choice of target site, a green checkmark, then **"Toon map in Verkenner"**; the list of shared files; duplicate chains with a confirmation dialog and undo. **Verkenner**: site cards with "Toon map in Verkenner", and a before/after Windows Explorer preview (`<details>` tree, "Nieuw" badge on the shortcut, moved files tagged). **Impact**: range bars per department, metaphors, cloning waste, privacy note. **Privacy & berekening**: scopes from the token, plus the coefficient table. |
| `outlook.html` | Outlook on the web + OnMessageSend Smart Alert | A live "clone" visual of the Rick van Kersbergen rule. On send: an alert dialog with **Deel als link / Toch verzenden / Terug naar bericht**. Only sizes and the recipient count are sent to the API. |

Security in the browser: a strict CSP (`default-src 'self'`, no inline scripts, no CDN, so it works offline on the VM), all dynamic text via `textContent` (XSS-safe), and the token in memory only. Accessibility: keyboard tabs, ARIA roles, a table view for the chart, `prefers-reduced-motion`, and light and dark themes.

---

## 9. Testing

`npm test` runs **26 automated tests** (Node's built-in test runner):

- **CO2 engine (12):** the 3.6 g/GB/yr derivation and the consistency of the stored derived rows, "single move = 0 storage", the sync formula, the backup lower bound of 0, active vs. dormant, duplicate removal, the Rick van Kersbergen 20× rule, cumulative waste, metaphors, outward band rounding, and fail-loud validation.
- **API (14):** 401 for missing, forged and expired tokens; the Action Hub filter; migrate, then 409, then 403 for a foreign file; snooze; clean-up that requires confirmation, recycles without deleting, and can be undone; the DB trigger blocking `DELETE`; mapper idempotency and the explorer view; 403 for a non-member site; Smart Alert amplification and send-anyway; k-anonymous impact without user columns; the coefficient table; input validation; and a separate run **without admin consent** (403 everywhere, banner flag).

---

## 10. From PoC to production

| PoC | Production |
|---|---|
| `graphMock.js` + SQLite | Microsoft Graph client (`@microsoft/microsoft-graph-client`) with an OBO token |
| `tokenService.js` (HMAC) | Entra ID: Teams SSO + MSAL Node OBO, JWKS validation, certificate in Key Vault |
| `simulated-sso` + user picker | Removed (`ENABLE_SIMULATED_SSO=false`) |
| `index.html` | Teams app manifest (personal tab) pointing to the same page |
| `outlook.html` | Outlook add-in manifest with `LaunchEvent` `OnMessageSend`, `SendMode: PromptUser` |
| SQLite telemetry | Azure SQL / Dataverse, same aggregated schema |
| Recycle-bin flag | Graph `DELETE` (to the recycle bin, never `permanentDelete`) + `restore` |
