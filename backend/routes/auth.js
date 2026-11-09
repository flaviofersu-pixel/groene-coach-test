/**
 * @file routes/auth.js
 * @description SIMULATION-ONLY sign-in. Stands in for Teams SSO
 * (`microsoftTeams.authentication.getAuthToken()`), which a production build
 * uses instead; these routes are then disabled (ENABLE_SIMULATED_SSO=false).
 */

import { Router } from 'express';
import { HttpError, requireId } from '../errors.js';

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {ReturnType<import('../auth/tokenService.js').createTokenService>} tokenService
 */
export function createAuthRouter(db, tokenService) {
  const router = Router();
  const users = db.prepare('SELECT id, display_name, department FROM users ORDER BY id');
  const userById = db.prepare('SELECT id, display_name, department FROM users WHERE id = ?');

  /** GET /api/auth/simulated-users: the "who am I" picker of the demo. */
  router.get('/simulated-users', (_req, res) => res.json({ users: users.all() }));

  /** POST /api/auth/simulated-sso  { userId } -> short-lived Bearer token. */
  router.post('/simulated-sso', (req, res) => {
    const userId = requireId(req.body?.userId, 'userId');
    const user = userById.get(userId);
    if (!user) throw new HttpError(404, `Gebruiker '${userId}' bestaat niet.`);
    res.json({ ...tokenService.issue(user), user });
  });

  return router;
}
