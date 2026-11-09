# Klimaattool: Data Lifecycle & Carbon Reduction Tool (PoC)

A proof of concept for a simulated **Gemeente Amsterdam** Microsoft 365 workspace. The tool lowers digital CO2 emissions by coaching employees to move **heavily shared files** from their personal **OneDrive** to a central **SharePoint** environment, and it shows the effect in a Teams-style dashboard.

> **Fully simulated.** The tool never connects to the real Microsoft Graph API or any production server. It only reads and writes its own local SQLite database (`data/m365-mock.db`) and has no access to other files on the VM.

| Component | What it does | URL (default) |
|---|---|---|
| **M365 Cloud Simulation** (backend) | Express REST API + SQLite "Graph mock database" + CO2 engine | `http://127.0.0.1:3001/api` |
| **Desktop coaching widget** | Simulated tray extension. Suggests migrations in friendly Dutch | `http://127.0.0.1:3000/` |
| **Teams dashboard** | Simulated Teams tab: MB migrated, CO2 saved, Amsterdam metaphors | `http://127.0.0.1:3000/dashboard.html` |

Technical design, API reference, database schema and the CO2 formulas: see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## 1. Quick start (if Node.js is already installed)

```bash
npm ci          # install the single dependency (express)
npm run seed    # create + fill the mock database (65 files, 12 users)
npm start       # start backend AND frontend together
```

Then open **http://127.0.0.1:3000/** in a browser. Press `Ctrl+C` to stop both servers.

---

## 2. Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | **22.13 or newer** (LTS 22 or 24 recommended) | Uses the built-in `node:sqlite` module, so no database server or native compilation is needed |
| npm | ships with Node.js | |
| Browser | any current Chromium, Edge or Firefox | Must run on the VM, or on a machine that can reach the VM (see 3.5) |
| Disk / RAM | < 50 MB / < 200 MB | |

No PostgreSQL, Docker or internet connection is needed at runtime. All frontend assets are self-hosted (no CDN).

---

## 3. Hosting on a clean virtual machine (step by step)

### 3.1 Install Node.js

**Ubuntu Server 22.04 / 24.04**

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version      # must print v22.13.0 or higher
```

**Windows 10/11 or Windows Server 2019+**

1. Download the **LTS "Windows Installer (.msi)"** from https://nodejs.org (version 22.13 or newer).
2. Run it with the default options.
3. Open a new **PowerShell** window and check: `node --version`.

**Air-gapped VM (no internet):** download the Node.js installer and run `npm ci` on a machine *with* internet access. Then copy the whole project folder, **including `node_modules/`**, to the VM. Express is pure JavaScript, so the folder works on every operating system.

### 3.2 Copy the project to the VM

Copy the project folder to the VM, for example to `/opt/klimaattool` (Linux) or `C:\klimaattool` (Windows), or clone it from your repository. Then open a terminal in that folder.

### 3.3 Install dependencies

```bash
npm ci
```

`npm ci` installs exactly the versions in `package-lock.json` (reproducible). `npm install` also works.

### 3.4 Run the database seed script

```bash
npm run seed
```

Expected output:

```
[seed] Database: /opt/klimaattool/data/m365-mock.db
[seed] Inserted 12 users, 65 files, 12 historical migrations.
```

This **wipes and recreates** all demo data. Run it again at any time to reset the demo. (If you skip this step, the backend seeds an empty database automatically on its first start.)

### 3.5 Launch frontend and backend simultaneously

```bash
npm start
```

This runs [scripts/start-all.js](scripts/start-all.js). The script starts the backend, waits until `GET /api/health` answers, then starts the frontend. Both logs appear in one terminal:

```
[api] M365 Cloud Simulation listening on http://127.0.0.1:3001
[start] Both servers are running. Press Ctrl+C to stop.
[web] Desktop widget:  http://127.0.0.1:3000/
[web] Teams dashboard: http://127.0.0.1:3000/dashboard.html
```

If one process crashes, the other is stopped too. To run the servers in **two separate terminals** instead:

```bash
npm run start:backend     # terminal 1
npm run start:frontend    # terminal 2
```

**Opening the UI from the host machine (VM without a desktop):** expose only the frontend. The API stays private, because the frontend server proxies `/api` to it over loopback.

```bash
FRONTEND_HOST=0.0.0.0 npm start                       # Linux / macOS
$env:FRONTEND_HOST="0.0.0.0"; npm start               # Windows PowerShell
```

Then browse to `http://<vm-ip>:3000/`. Only do this on an isolated test network.

### 3.6 Verify the installation

```bash
npm test                                         # 20 automated tests, all must pass
curl http://127.0.0.1:3001/api/health            # {"status":"ok",...}
```

### 3.7 (Optional) Run as a background service on Linux

`/etc/systemd/system/klimaattool.service`:

```ini
[Unit]
Description=Klimaattool PoC (M365 simulation + UI)
After=network.target

[Service]
WorkingDirectory=/opt/klimaattool
ExecStart=/usr/bin/node scripts/start-all.js
Restart=on-failure
User=klimaattool

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system klimaattool && sudo chown -R klimaattool /opt/klimaattool
sudo systemctl daemon-reload && sudo systemctl enable --now klimaattool
```

---

## 4. Using the demo

1. **Desktop widget** (`/`). After about a second, a notification card appears in the bottom-right corner:
   > *Samen groener werken? 🌿 Dit bestand wordt intensief gedeeld. Zullen we het verhuizen naar SharePoint? Dit scheelt cloud-energie en zet het direct op de juiste plek voor je collega's.*
   - **Ja, verhuis het**: the file moves to SharePoint, a green checkmark shows the CO2 saved, and the next suggestion follows.
   - **Nu niet**: the card closes, the choice is logged, and the file is not suggested again for 7 days.
   - **–** (or `Esc`): the card is tucked away. Click the 🌿 tray icon to bring it back.
   - Suggestions are ordered by impact (largest CO2 saving first), one card at a time.
2. **Teams dashboard** (`/dashboard.html`) shows MB migrated, CO2 saved by you, your department and the whole municipality, Amsterdam metaphors (canal lantern 🏮, Vondelpark tree 🌳, car km 🚲), a department ranking, and your choices. It updates instantly when you migrate a file in the widget (keep both tabs open side by side). The **Berekening** tab explains the calculation.
3. Use the yellow **Simulatie** dropdown to switch between the 12 fictional employees. The default user is *Sanne de Vries (Wonen)*.

To start the demo over: stop the servers, run `npm run seed`, then run `npm start`.

---

## 5. API at a glance

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/files/scan-onedrive[?user=u01]` | OneDrive files with `share_count > 2`, including projected CO2 saving |
| POST | `/api/files/migrate-to-sharepoint` | Body `{ "fileId": 2, "userId": "u01" }`. Moves the file to SharePoint |
| POST | `/api/files/decline` | Body `{ "fileId": 2, "userId": "u01" }`. Logs a "Nu niet" answer |
| GET | `/api/stats/co2-saved[?user=u01]` | Total CO2 saved (organisation / department / user) |
| GET | `/api/users` | Simulated user directory |
| GET | `/api/files[?location=OneDrive&user=u01]` | All drive items |
| GET | `/api/health` | Liveness probe |

Example:

```bash
curl "http://127.0.0.1:3001/api/files/scan-onedrive?user=u01"
curl -X POST http://127.0.0.1:3001/api/files/migrate-to-sharepoint \
     -H "Content-Type: application/json" -d '{"fileId": 2, "userId": "u01"}'
curl "http://127.0.0.1:3001/api/stats/co2-saved?user=u01"
```

Full request and response documentation is in [ARCHITECTURE.md §2](ARCHITECTURE.md#2-rest-api).

---

## 6. CO2 model in one paragraph

For each file the engine computes the yearly energy use **in OneDrive** and **on SharePoint**. The difference is the saving. **Storage:** 1 GB stored for a year costs 0.015 kWh. Sharing from a personal OneDrive creates redundant copies (25 % of collaborators), while SharePoint keeps one copy. **Network sync:** every collaborator syncs the file (52 full syncs per year, 0.03 kWh/GB). SharePoint's delta-sync cuts that traffic by **40 %**. Energy is converted at **300 g CO2e/kWh**. Example: a 5.8 MB spreadsheet shared with 14 people saves **14.9 g CO2 per year (−40.1 %)**. All coefficients, sources, a worked example and the model's limitations are in [ARCHITECTURE.md §4](ARCHITECTURE.md#4-co2-calculation-logic).

---

## 7. Configuration

All settings have safe defaults and can be overridden with environment variables:

| Variable | Default | Used by | Meaning |
|---|---|---|---|
| `API_PORT` | `3001` | backend, frontend proxy, start script | REST API port |
| `API_HOST` | `127.0.0.1` | backend | Interface the API binds to |
| `FRONTEND_PORT` | `3000` | frontend | UI port |
| `FRONTEND_HOST` | `127.0.0.1` | frontend | Interface the UI binds to |
| `API_TARGET_HOST` | `127.0.0.1` | frontend proxy | Where the proxy finds the API |
| `DB_PATH` | `data/m365-mock.db` | backend, seed | SQLite file (`:memory:` for a throw-away DB) |

Business rules (`shareThreshold = 2`, `snoozeDays = 7`, default user) are in [backend/config.js](backend/config.js). The CO2 coefficients are in [backend/services/co2Calculator.js](backend/services/co2Calculator.js).

---

## 8. Project structure

```
├── backend/
│   ├── server.js               Entry point: open DB, auto-seed if empty, listen
│   ├── app.js                  Express app factory (also used by tests)
│   ├── config.js               Ports, DB path, business rules
│   ├── errors.js               HttpError + input validators
│   ├── middleware/index.js     Security headers, logging, 404, error handler
│   ├── routes/                 files.js · stats.js · users.js (HTTP layer)
│   ├── services/
│   │   ├── co2Calculator.js    Green IT engine (pure functions + coefficients)
│   │   ├── fileService.js      Scan, migrate, decline (business rules + SQL)
│   │   └── statsService.js     Aggregations for the dashboard
│   └── db/
│       ├── schema.sql          Tables, constraints, indexes
│       ├── database.js         node:sqlite connection + transaction helper
│       ├── seed.js             Seed script (npm run seed)
│       └── seedData.js         65 fictional municipal files, 12 users
├── frontend/
│   ├── server.js               Static server + /api proxy
│   └── public/
│       ├── index.html          Desktop widget (simulated VM desktop)
│       ├── dashboard.html      Teams tab (simulated)
│       ├── css/                base.css (tokens, light/dark) · desktop.css · teams.css
│       └── js/                 api.js · format.js · widget.js · dashboard.js
├── scripts/start-all.js        Runs backend + frontend together
├── tests/                      co2Calculator.test.js · api.test.js
├── data/                       m365-mock.db (generated, git-ignored)
├── README.md
└── ARCHITECTURE.md
```

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `No such built-in module: node:sqlite` | Node.js is too old. Install 22.13 or newer |
| `EADDRINUSE: address already in use :::3001` | Another process uses the port. Stop it, or start with `API_PORT=3101 FRONTEND_PORT=3100 npm start` |
| Widget shows *"De M365-simulatie (backend) is niet bereikbaar"* | The backend is not running. Use `npm start`, or start `npm run start:backend` first |
| No notification appears | The selected user has no qualifying files left (all migrated or snoozed). Click the 🌿 tray icon, switch user, or run `npm run seed` to reset |
| Dashboard numbers look tiny | Expected. Savings are per file per year and the demo has 65 files. Migrate the large files (`.zip`, `.pptx`) to see bigger jumps |

---

## 10. Privacy & compliance summary

- No outbound network calls. The frontend Content-Security-Policy allows only `'self'`.
- The only file the tool writes is `data/m365-mock.db`. No endpoint accepts a file path, and the static server only serves `frontend/public`.
- Both servers listen on `127.0.0.1` by default.
- All people in the dataset are fictional, and e-mail addresses use the reserved `.example` domain.
- Users stay in control: "Nu niet" is honoured immediately, logged and respected for 7 days. Only the owner can move a file.
