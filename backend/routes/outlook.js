/**
 * @file routes/outlook.js
 * @description Endpoints called by the (simulated) Outlook OnMessageSend add-in.
 */

import { Router } from 'express';
import { requireEnum, requireIdList, requireIntInRange } from '../errors.js';

/** @param {ReturnType<import('../services/outlookService.js').createOutlookService>} outlook */
export function createOutlookRouter(outlook) {
  const router = Router();
  const parse = (body = {}) => ({
    fileIds: requireIdList(body.fileIds, 'fileIds'),
    recipientCount: requireIntInRange(body.recipientCount, 'recipientCount', 1, 500),
  });

  /** POST /api/outlook/evaluate-send  { fileIds: [..], recipientCount } */
  router.post('/evaluate-send', (req, res) => res.json(outlook.evaluateSend(req.actor, parse(req.body))));

  /** POST /api/outlook/resolve  { decision, fileIds, recipientCount } */
  router.post('/resolve', (req, res) => {
    res.json(outlook.resolve(req.actor, {
      decision: requireEnum(req.body?.decision, 'decision', ['share_link', 'send_anyway', 'cancel']),
      ...parse(req.body),
    }));
  });

  return router;
}
