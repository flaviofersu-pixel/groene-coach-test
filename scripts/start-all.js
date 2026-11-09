/**
 * @file scripts/start-all.js
 * @description `npm start`: launches backend and frontend together with one
 * command and no extra dependencies (no `concurrently` needed).
 *
 *  1. Starts the backend and waits until GET /api/health answers.
 *  2. Starts the frontend server.
 *  3. Prefixes each process' output ([api] / [web] lines are already tagged).
 *  4. Ctrl+C stops both; if one crashes, the other is stopped too.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = Number(process.env.API_PORT) || 3001;
const HEALTH_URL = `http://127.0.0.1:${API_PORT}/api/health`;

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let shuttingDown = false;

/** Starts `node <script>` with inherited env/stdio and tracks the child. */
function start(script) {
  const child = spawn(process.execPath, [path.join(ROOT, script)], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[start] ${script} exited with code ${code}; stopping everything.`);
      stopAll(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

function stopAll(exitCode = 0) {
  shuttingDown = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 500);
}

/** Polls the health endpoint until it answers or the timeout expires. */
async function waitForBackend(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // Not listening yet: retry below.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

start('backend/server.js');
if (!(await waitForBackend())) {
  console.error(`[start] Backend did not become healthy at ${HEALTH_URL}.`);
  stopAll(1);
} else {
  start('frontend/server.js');
  console.log('[start] Both servers are running. Press Ctrl+C to stop.');
}
