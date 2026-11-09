/**
 * @file app.js
 * @description Composition root: wires database, gateway, services and routes
 * into one Express application (dependency injection by hand, no framework).
 *
 * Kept separate from server.js so tests can build the app with an in-memory
 * database, a fixed clock and custom auth settings.
 */

import express from 'express';
import { config } from './config.js';
import { createTokenService } from './auth/tokenService.js';
import { createGraphMock } from './graph/graphMock.js';
import { coefficientsFromRows } from './services/co2Calculator.js';
import { createTelemetry } from './services/telemetry.js';
import { createActionHubService } from './services/actionHubService.js';
import { createUserService } from './services/userService.js';
import { createOutlookService } from './services/outlookService.js';
import { createImpactService } from './services/impactService.js';
import { createAuthRouter } from './routes/auth.js';
import { createFilesRouter } from './routes/files.js';
import { createUserRouter } from './routes/user.js';
import { createOutlookRouter } from './routes/outlook.js';
import { createStatsRouter } from './routes/stats.js';
import { securityHeaders, requestLogger, requireAuth, notFound, errorHandler } from './middleware/index.js';

/**
 * @param {object} options
 * @param {import('node:sqlite').DatabaseSync} options.db
 * @param {boolean} [options.logRequests=true]
 * @param {() => Date} [options.now]           injectable clock (tests)
 * @param {typeof config.auth} [options.auth]  injectable auth settings (tests)
 * @param {boolean} [options.enableSimulatedSso=true]
 */
export function createApp({ db, logRequests = true, now = () => new Date(), auth = config.auth, enableSimulatedSso = true }) {
  // Coefficients are read once from co2_metrics (restart to apply changes).
  const coefficients = coefficientsFromRows(db.prepare('SELECT * FROM co2_metrics').all());

  const tokenService = createTokenService(auth, { now });
  const graph = createGraphMock(db, { now });
  const telemetry = createTelemetry(db);
  const deps = { db, graph, coefficients, telemetry, now };

  const hub = createActionHubService(deps);
  const users = createUserService(deps);
  const outlook = createOutlookService(deps);
  const impact = createImpactService(deps);

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  if (logRequests) app.use(requestLogger);
  app.use(express.json({ limit: '10kb' })); // ids only; file contents never pass through the API

  // --- Public endpoints ---------------------------------------------------------------
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'm365-tenant-simulation' }));
  app.get('/api/co2-metrics', (_req, res) => res.json(impact.metrics()));
  if (enableSimulatedSso) app.use('/api/auth', createAuthRouter(db, tokenService));

  // --- Authenticated endpoints (identity from the validated token) ----------------------
  const authenticated = requireAuth(tokenService);
  app.use('/api/files', authenticated, createFilesRouter(hub));
  app.use('/api/user', authenticated, createUserRouter(users));
  app.use('/api/outlook', authenticated, createOutlookRouter(outlook));
  app.use('/api/stats', authenticated, createStatsRouter(impact));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
