/**
 * @file server.js
 * @description Backend entry point: open the tenant simulation (seed on first
 * start), run the retention job, serve HTTP, shut down cleanly.
 *
 * Run: npm run start:backend   (or `npm start` for backend + frontend)
 */

import { config } from './config.js';
import { openDatabase, isEmpty, isOutdated } from './db/database.js';
import { seedDatabase } from './db/seed.js';
import { purgeExpiredPersonalData } from './services/retention.js';
import { createApp } from './app.js';

const db = openDatabase(config.dbPath);

// First start, or the demo data model changed: (re)build the simulated tenant.
if (isEmpty(db) || isOutdated(db)) {
  const reason = isEmpty(db) ? 'Empty database detected' : 'Demo data model changed';
  const counts = seedDatabase(db);
  console.log(`[api] ${reason}, seeded ${counts.files} files for ${counts.users} users.`);
}

// Storage limitation: purge expired personal data now and every hour.
const runRetention = () => {
  const removed = purgeExpiredPersonalData(db);
  if (removed.snoozes || removed.auditRows) console.log(`[api] Retention: removed ${removed.snoozes} snoozes, ${removed.auditRows} audit rows.`);
};
runRetention();
const retentionTimer = setInterval(runRetention, 60 * 60 * 1000);
retentionTimer.unref();

const app = createApp({ db, enableSimulatedSso: process.env.ENABLE_SIMULATED_SSO !== 'false' });

const server = app.listen(config.port, config.host, () => {
  console.log(`[api] M365 tenant simulation listening on http://${config.host}:${config.port}`);
  console.log(`[api] Database: ${config.dbPath}`);
  console.log(`[api] Admin consent for Files.ReadWrite.All: ${config.auth.adminConsentGranted ? 'granted' : 'NOT granted'}`);
});

/** Stop accepting requests, then close the database so WAL data is flushed. */
function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
