/**
 * @file routes/stats.js
 * @description HTTP layer for CO2 statistics (consumed by the Teams dashboard).
 */

import { Router } from 'express';
import { optionalUserId } from '../errors.js';

/** @param {ReturnType<import('../services/statsService.js').createStatsService>} statsService */
export function createStatsRouter(statsService) {
  const router = Router();

  /**
   * GET /api/stats/co2-saved?user=u01
   * Total CO2 saved by migrated files (organisation, department, user).
   */
  router.get('/co2-saved', (req, res) => {
    res.json(statsService.getCo2Saved({ userId: optionalUserId(req.query.user, 'user') }));
  });

  return router;
}
