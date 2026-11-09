/**
 * @file app.js
 * @description Builds the Express application ("M365 Cloud Simulation" REST API).
 *
 * Kept separate from server.js so tests can create the app with an in-memory
 * database and drive it over HTTP without touching the real data file.
 */

import express from 'express';
import { createFileService } from './services/fileService.js';
import { createStatsService } from './services/statsService.js';
import { createFilesRouter } from './routes/files.js';
import { createStatsRouter } from './routes/stats.js';
import { createUsersRouter } from './routes/users.js';
import { securityHeaders, requestLogger, notFound, errorHandler } from './middleware/index.js';

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, logRequests?: boolean, now?: () => Date }} options
 * @returns {import('express').Express}
 */
export function createApp({ db, logRequests = true, now }) {
  const fileService = createFileService(db, { now });
  const statsService = createStatsService(db, fileService);

  const app = express();
  app.disable('x-powered-by');

  app.use(securityHeaders);
  if (logRequests) app.use(requestLogger);
  // Small bodies only: the API never receives file contents, just ids.
  app.use(express.json({ limit: '10kb' }));

  /** GET /api/health: liveness probe for the start script / VM monitoring. */
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'm365-cloud-simulation' }));

  app.use('/api/users', createUsersRouter(fileService));
  app.use('/api/files', createFilesRouter(fileService));
  app.use('/api/stats', createStatsRouter(statsService));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
