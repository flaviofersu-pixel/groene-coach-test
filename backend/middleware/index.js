/**
 * @file middleware/index.js
 * @description Cross-cutting Express middleware (Chain of Responsibility):
 * security headers, request logging, authentication, 404 and error handling.
 */

import { HttpError } from '../errors.js';

/** Conservative security headers for a JSON-only API. */
export function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  next();
}

/**
 * One log line per request. Logs the PATH only (never the query string,
 * headers or body), so tokens and personal data never end up in logs.
 */
export function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`[api] ${req.method} ${req.baseUrl}${req.path} -> ${res.statusCode} (${ms.toFixed(1)} ms)`);
  });
  next();
}

/**
 * Authentication: requires `Authorization: Bearer <token>`, validates it and
 * exposes the caller as `req.actor` ({ sub, name, department, scopes, exp }).
 * Identity ALWAYS comes from the validated token, never from the request body.
 * @param {ReturnType<import('../auth/tokenService.js').createTokenService>} tokenService
 */
export function requireAuth(tokenService) {
  return (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
    if (!match) return next(new HttpError(401, 'Niet aangemeld of sessie verlopen.'));
    req.actor = tokenService.verify(match[1]);
    return next();
  };
}

/** Unknown routes become a JSON 404. */
export function notFound(req, _res, next) {
  next(new HttpError(404, `Endpoint ${req.method} ${req.path} bestaat niet.`));
}

/**
 * Central error handler. Expected errors keep their status; anything else is
 * a generic 500 (details only in the server log, never sent to the client).
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = 500;
  let message = 'Er ging iets mis op de server.';

  if (err instanceof HttpError) {
    ({ status, message } = err);
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Ongeldige JSON in request body.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is te groot.';
  } else {
    console.error('[api] Unexpected error:', err);
  }

  if (status === 401) res.set('WWW-Authenticate', 'Bearer');
  res.status(status).json({ error: { status, message } });
}
