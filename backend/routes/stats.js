/**
 * @file routes/stats.js
 * @description Impact statistics for the metaphor dashboard.
 */

import { Router } from 'express';

/** @param {ReturnType<import('../services/impactService.js').createImpactService>} impact */
export function createStatsRouter(impact) {
  const router = Router();

  /** GET /api/stats/impact: personal (own), per team (k-anonymous) and organisation figures. */
  router.get('/impact', (req, res) => res.json(impact.getImpact(req.actor)));

  return router;
}
