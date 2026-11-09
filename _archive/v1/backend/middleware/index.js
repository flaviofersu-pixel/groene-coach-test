/**
 * @file middleware/index.js
 * @description Cross-cutting Express middleware: security headers, request
 * logging, 404 handling and the central error handler.
 */

import { HttpError } from '../errors.js';

/**
 * Conservative security headers for a JSON-only API. Without a dependency such
 * as helmet, only what this API needs is set.
 */
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

/** One log line per request: method, path, status, duration. */
export function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms.toFixed(1)} ms)`);
  });
  next();
}

/** Unknown routes become a JSON 404 instead of Express' default HTML page. */
export function notFound(req, _res, next) {
  next(new HttpError(404, `Endpoint ${req.method} ${req.path} bestaat niet.`));
}

/**
 * Central error handler (Express recognises it by its 4 parameters).
 * Expected errors (HttpError, malformed JSON) keep their status; anything else
 * becomes a 500 without leaking internals to the client.
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

  res.status(status).json({ error: { status, message } });
}
