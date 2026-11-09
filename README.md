# Groene Coach: Data Lifecycle & Carbon Reduction Tool (PoC v2)

**Version 2: "From Insight to Action"**, for a simulated **Gemeente Amsterdam** Microsoft 365 tenant.

The Groene Coach is a **Microsoft Teams web app** plus a simulated **Outlook Smart Alert**. It politely coaches civil servants to:

1. move intensively shared files from their personal **OneDrive** to the department's **SharePoint** site (the right place under the Archiefwet);
2. add their department library to OneDrive with **one click** ("Toon map in Verkenner");
3. clean up **identical copies** (only after confirmation, via the recycle bin, and reversible);
4. share **links instead of attachments** (1 attachment to 20 people = 20× storage).

CO2 figures are honest **ranges** ("0,4 – 9 gram CO₂ per jaar"), based on the updated Dutch grid mix (0.268 kg/kWh), 0.65 W/TB and a PUE of 1.185.

> **Fully simulated and compliant by design.** No connection to the real Microsoft Graph or to production. The tool only uses its own SQLite database (`data/m365-tenant-sim.db`). Nothing is installed on laptops, nothing is deleted automatically, and the civil servant always decides.

| What | URL (default) |
|---|---|
| Teams app "Groene Coach" | http://127.0.0.1:3000/ |
| Outlook Smart Alert simulation | http://127.0.0.1:3000/outlook.html |
| REST API (simulated Graph + coach) | http://127.0.0.1:3001/api |

Design, permissions, privacy, Archiefwet and the CO2 formulas are in **[ARCHITECTURE.md](ARCHITECTURE.md)**, written for the CISO and Privacy Officer.

---

## 1. Quick start (Node.js already installed)

```bash
npm ci          # install the single dependency (express)
npm run seed    # build the simulated tenant: 18 users, 7 SharePoint sites, 66 files
npm start       # start backend + frontend together
```

Open **http://127.0.0.1:3000/** and press `Ctrl+C` to stop.

---

## 2. Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | **22.13 or newer** (LTS 22 or 24) | Uses the built-in `node:sqlite`: no database server and no native compilation |
| npm | ships with Node.js | |
| Browser | current Edge, Chrome or Firefox | On the VM, or on a host that can reach it (see 3.6) |
| Resources | < 50 MB disk, < 200 MB RAM | |

No internet is needed at runtime. All frontend assets are self-hosted (no CDN).

---

## 3. Hosting inside a virtual machine (step by step)

### 3.1 Create the VM

Any hypervisor works (Hyper-V, VirtualBox, VMware, Azure/Proxmox). Recommended: **Ubuntu Server 24.04 LTS** or **Windows Server 2022 / Windows 11**, 1 vCPU, 2 GB RAM, 10 GB disk. For the "secure municipal cloud" simulation, attach the VM to an **isolated/host-only network**.

### 3.2 Install Node.js

**Ubuntu**

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version          # must print v22.13.0 or higher
```

**Windows:** download the **LTS Windows Installer (.msi)** from https://nodejs.org, install it with the defaults, open a *new* PowerShell window and run `node --version`.

**VM without internet (air-gapped):** on a machine with internet access, run `npm ci` in the project folder. Then copy the whole folder, **including `node_modules/`**, plus the Node.js installer to the VM. Express is pure JavaScript, so this works across operating systems.

### 3.3 Copy the project to the VM

For example to `/opt/groenecoach` (Linux) or `C:\groenecoach` (Windows). Open a terminal in that folder.

### 3.4 Install dependencies and seed the database

```bash
npm ci
npm run seed
```

Expected:

```
[seed] Database: /opt/groenecoach/data/m365-tenant-sim.db
[seed] 18 users, 7 SharePoint sites, 66 files, 10 historical migrations.
```

`npm run seed` **drops and rebuilds** the demo tenant. Run it any time to reset the demo. If you skip it, the backend seeds an empty database on its first start.

### 3.5 Start backend and frontend together

```bash
npm start
```

[scripts/start-all.js](scripts/start-all.js) starts the backend, waits for `GET /api/health`, then starts the frontend:

```
[api] M365 tenant simulation listening on http://127.0.0.1:3001
[api] Admin consent for Files.ReadWrite.All: granted
[start] Both servers are running. Press Ctrl+C to stop.
[web] Teams app (Groene Coach): http://127.0.0.1:3000/
[web] Outlook Smart Alert:      http://127.0.0.1:3000/outlook.html
```

To use separate terminals instead: run `npm run start:backend` and `npm run start:frontend`.

### 3.6 Reach the UI from the host machine (VM without a desktop)

Expose **only the frontend**. The API stays on loopback, because the frontend server proxies `/api` to it.

```bash
FRONTEND_HOST=0.0.0.0 npm start                     # Linux
$env:FRONTEND_HOST="0.0.0.0"; npm start             # Windows PowerShell
```

Then browse to `http://<vm-ip>:3000/`. On Ubuntu, also allow the port: `sudo ufw allow 3000/tcp`. Do this only on an isolated test network.

### 3.7 Verify

```bash
npm test                                   # 26 automated tests, all must pass
curl http://127.0.0.1:3001/api/health      # {"status":"ok",...}
```

### 3.8 (Optional) Run as a service (Linux, systemd)

`/etc/systemd/system/groenecoach.service`:

```ini
[Unit]
Description=Groene Coach PoC (M365 simulation + Teams/Outlook web UI)
After=network.target

[Service]
WorkingDirectory=/opt/groenecoach
ExecStart=/usr/bin/node scripts/start-all.js
Environment=TOKEN_SIGNING_SECRET=change-me-to-a-long-random-value
Restart=on-failure
User=groenecoach

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system groenecoach && sudo chown -R groenecoach /opt/groenecoach
sudo systemctl daemon-reload && sudo systemctl enable --now groenecoach
```

---

## 4. Demo script (about 5 minutes)

1. **Actie-hub (Teams).** Signed in as *Sanne de Vries (Wonen)*. The nudge shows: *"Samen groener werken, Sanne? 🌿 Dit bestand wordt intensief gedeeld met je team…"*. Open **"Waarom een bandbreedte?"**: storage **0 gram**, plus sync and back-up ranges. Click **Ja, verhuis het** to see the green checkmark.
2. Click **Toon map in Verkenner**. The **Verkenner** tab opens: *Voor* shows the cluttered personal OneDrive, *Na* shows the new **"Wonen - Documenten"** shortcut (badge "Nieuw") containing the moved file.
3. Back in the **Actie-hub**, under **Dubbele kopieën**, click **Ruim mijn kopieën op…** for the Woonvisie presentation. A confirmation dialog appears, the copy goes to the recycle bin, and the toast offers **Ongedaan maken**.
4. Click **Nu niet** on another suggestion: it disappears for 7 days, and the file stays where it is.
5. **Outlook** (link at the top). Choose the 48.5 MB presentation and **Afdeling (20)**, then **Verzenden**. The Smart Alert explains the 20× clones and offers **Deel als link / Toch verzenden / Terug naar bericht**.
6. **Impact** shows ranges for you, your department and the municipality, canal-lamp hours, cooling kWh, cloning waste and the range bars per department. **Privacy & berekening** shows the granted Graph scopes and the coefficient table.
7. *(Optional)* **Admin consent missing:** stop the servers, run `ADMIN_CONSENT=false npm start`, and reload. A banner explains that `Files.ReadWrite.All` needs admin consent, and every file operation is refused (403).

Use the yellow **Simulatie** dropdown to switch between the 18 fictional employees. Open the Teams app and Outlook side by side: the Teams app updates live when Outlook records a link.

---

## 5. API at a glance

All `/api/files`, `/api/user`, `/api/outlook` and `/api/stats` routes require `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/simulated-sso` | `{ "userId": "u01" }` → 15-minute token (demo only) |
| GET | `/api/files/scan-onedrive` | Own OneDrive files with `times_shared > 2` and a CO2 range |
| GET | `/api/files/duplicate-chains` | Identical-copy chains you are part of |
| POST | `/api/files/migrate-to-sharepoint` | `{ "fileId": 2, "siteId": "s01" }` (site is optional) |
| POST | `/api/files/snooze` | `{ "fileId": 2 }` → "Nu niet" |
| POST | `/api/files/consolidate-duplicates` | `{ "contentHash": "…", "confirmed": true }` |
| POST | `/api/files/:id/restore` | Undo a clean-up |
| POST | `/api/user/map-sharepoint-shortcut` | `{ "siteId": "s01" }` → SharePoint shortcut in OneDrive |
| GET | `/api/user/explorer-view` | Before/after Explorer trees |
| POST | `/api/outlook/evaluate-send` | `{ "fileIds": [3], "recipientCount": 20 }` → Smart Alert decision |
| POST | `/api/outlook/resolve` | `{ "decision": "share_link", "fileIds": [3], "recipientCount": 20 }` |
| GET | `/api/stats/impact` | Personal / department / organisation impact (ranges) |
| GET | `/api/co2-metrics` | Coefficient table (public) |

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3001/api/auth/simulated-sso \
  -H "Content-Type: application/json" -d '{"userId":"u01"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).access_token")
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3001/api/files/scan-onedrive
```

Full reference: [ARCHITECTURE.md §6](ARCHITECTURE.md#6-rest-api).

---

## 6. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `API_PORT` / `API_HOST` | `3001` / `127.0.0.1` | REST API |
| `FRONTEND_PORT` / `FRONTEND_HOST` | `3000` / `127.0.0.1` | Web UI |
| `API_TARGET_HOST` | `127.0.0.1` | Where the frontend proxy finds the API |
| `DB_PATH` | `data/m365-tenant-sim.db` | SQLite file (`:memory:` for a throw-away DB) |
| `ADMIN_CONSENT` | `true` | `false` simulates a tenant without admin consent for `Files.ReadWrite.All` |
| `TOKEN_SIGNING_SECRET` | random per start | Set it to keep tokens valid across restarts. Never commit it |
| `ENABLE_SIMULATED_SSO` | `true` | `false` disables the demo sign-in endpoints |

Business rules (share threshold 2, snooze 7 days, minimum group size 3, audit retention 365 days, Smart Alert thresholds) are in [backend/config.js](backend/config.js). The CO2 coefficients are in the `co2_metrics` table, seeded from [backend/db/seedData.js](backend/db/seedData.js).

---

## 7. Project structure

```
├── backend/
│   ├── server.js                 Entry: open DB, seed if empty, hourly retention job, listen
│   ├── app.js                    Composition root (dependency injection)
│   ├── config.js                 Settings, Graph scopes, admin-consent simulation
│   ├── errors.js                 HttpError + allow-list validators
│   ├── auth/tokenService.js      Simulated Entra/Teams SSO tokens (HMAC, 15 min)
│   ├── graph/graphMock.js        Microsoft Graph boundary: scope + ownership checks, no hard delete
│   ├── middleware/index.js       Security headers, path-only logging, requireAuth, errors
│   ├── routes/                   auth · files · user · outlook · stats (thin controllers)
│   ├── services/
│   │   ├── co2Calculator.js      Honest CO2 engine (pure functions, ranges)
│   │   ├── actionHubService.js   Scan, migrate, snooze, duplicate clean-up, restore
│   │   ├── userService.js        Profile + SharePoint Mapper + Explorer view
│   │   ├── outlookService.js     Smart Alert evaluation (Rick van Kersbergen rule)
│   │   ├── impactService.js      Aggregated, k-anonymous impact + metaphors
│   │   ├── telemetry.js          Aggregate-on-write telemetry (no user ids)
│   │   ├── retention.js          Purge expired personal data
│   │   └── present.js            Bands → API shapes
│   └── db/                       schema.sql · database.js · seed.js · seedData.js
├── frontend/
│   ├── server.js                 Static files + /api proxy + strict CSP
│   └── public/
│       ├── index.html            Teams app (Actie-hub, Verkenner, Impact, Privacy)
│       ├── outlook.html          Outlook compose + Smart Alert
│       ├── css/                  base.css (tokens, light/dark) · teams.css · outlook.css
│       └── js/                   api · dom · format · app · actionHub · explorer · impact · about · outlook
├── scripts/start-all.js          Starts backend + frontend together
├── tests/                        co2Calculator.test.js · api.test.js
├── _archive/v1/                  Previous version (desktop widget), kept for reference
├── README.md
└── ARCHITECTURE.md
```

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `No such built-in module: node:sqlite` | Node.js is too old. Install 22.13 or newer |
| `EADDRINUSE` | The port is taken. Run `API_PORT=3101 FRONTEND_PORT=3100 npm start` |
| "De M365-simulatie (backend) is niet bereikbaar" | The backend is not running. Use `npm start` |
| Yellow banner "Beheerder moet toestemming geven" | Started with `ADMIN_CONSENT=false`. Restart without it |
| No suggestions in the Actie-hub | Everything for this user is moved or snoozed. Switch user, or run `npm run seed` |
| The numbers look small | Correct and intentional. A single file saves grams per year, and the ranges are honest. See ARCHITECTURE.md §5.5 |

---

## 9. Compliance in one glance

- **No desktop software:** a Teams web app and an Outlook add-in (simulated).
- **Archiefwet:** never deletes (a DB trigger enforces it). Clean-up goes to the recycle bin after confirmation, only for identical copies, and can be undone. Records move to SharePoint.
- **AVG/GDPR:** aggregated telemetry without user ids, k ≥ 3, personal data only visible to yourself, retention of 7 and 365 days, no mail addresses or contents.
- **Graph permissions:** delegated `Files.ReadWrite.All` with admin consent. Tokens are validated server-side, kept in memory only and never logged.
