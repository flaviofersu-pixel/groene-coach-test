/**
 * @file server.js
 * @description Entry point of the backend. Opens the mock database (seeding it
 * on the very first start), starts the HTTP server and shuts down cleanly.
 *
 * Run: npm run start:backend   (or `npm start` for backend + frontend together)
 */

import { config } from './config.js';
import { openDatabase, isEmpty } from './db/database.js';
import { seedDatabase } from './db/seed.js';
import { createApp } from './app.js';

const db = openDatabase(config.dbPath);

// Convenience for a clean VM: an empty database is seeded automatically.
// `npm run seed` can always be used to reset to the initial dataset.
if (isEmpty(db)) {
  const counts = seedDatabase(db);
  console.log(`[api] Empty database detected, seeded ${counts.files} files for ${counts.users} users.`);
}

const app = createApp({ db });

const server = app.listen(config.port, config.host, () => {
  console.log(`[api] M365 Cloud Simulation listening on http://${config.host}:${config.port}`);
  console.log(`[api] Database: ${config.dbPath}`);
});

/** Stop accepting requests, then close the database so WAL data is flushed. */
function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down.`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Force exit if open connections keep the server alive.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
