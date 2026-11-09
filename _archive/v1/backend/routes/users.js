/**
 * @file routes/users.js
 * @description Simulated user directory, used by the frontend's
 * "simulated signed-in user" selector.
 */

import { Router } from 'express';

/** @param {ReturnType<import('../services/fileService.js').createFileService>} fileService */
export function createUsersRouter(fileService) {
  const router = Router();

  /** GET /api/users: all simulated Entra ID users. */
  router.get('/', (_req, res) => {
    res.json({ users: fileService.listUsers() });
  });

  return router;
}
