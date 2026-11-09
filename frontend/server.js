/**
 * @file frontend/server.js
 * @description Serves the web front-ends (the Groene Coach Teams app and the
 * Outlook Smart Alert simulation) and forwards every /api/* request to the backend.
 *
 * Why a proxy instead of calling the API directly from the browser?
 *  - The browser only ever talks to one origin, so no CORS configuration is
 *    needed and the API can stay bound to 127.0.0.1.
 *  - It mirrors how a real Teams tab / Outlook add-in would call its own
 *    backend instead of Microsoft Graph directly.
 *
 * Only the /frontend/public folder is served; dotfiles are ignored. No other
 * part of the VM's disk is reachable through this server.
 */

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const PORT = Number(process.env.FRONTEND_PORT) || 3000;
const HOST = process.env.FRONTEND_HOST || '127.0.0.1';
const API_TARGET_HOST = process.env.API_TARGET_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT) || 3001;

/**
 * Streams the incoming request to the backend and the response back to the
 * browser. A JSON 502 is returned when the backend is not running.
 */
function proxyToApi(req, res) {
  const upstream = http.request(
    {
      host: API_TARGET_HOST,
      port: API_PORT,
      method: req.method,
      path: req.originalUrl, // still contains the /api prefix
      headers: { ...req.headers, host: `${API_TARGET_HOST}:${API_PORT}` },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstream.on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ error: { status: 502, message: 'De M365-simulatie (backend) is niet bereikbaar.' } });
    }
  });

  req.pipe(upstream);
}

const app = express();
app.disable('x-powered-by');

// Strict Content-Security-Policy: everything is self-hosted (works offline on
// an isolated VM), so no external origin is ever allowed.
app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

app.use('/api', proxyToApi);
app.use(express.static(PUBLIC_DIR, { dotfiles: 'ignore', index: 'index.html' }));

app.listen(PORT, HOST, () => {
  console.log(`[web] Teams app (Groene Coach): http://${HOST}:${PORT}/`);
  console.log(`[web] Outlook Smart Alert:      http://${HOST}:${PORT}/outlook.html`);
  console.log(`[web] Proxying /api -> http://${API_TARGET_HOST}:${API_PORT}`);
});
