/**
 * @file routes/files.js
 * @description HTTP layer for drive items. Routes only translate HTTP <-> service
 * calls (parse + validate input, choose status codes); the logic lives in
 * services/fileService.js.
 */

import { Router } from 'express';
import { HttpError, optionalUserId, requirePositiveInt } from '../errors.js';
import { LOCATIONS } from '../services/co2Calculator.js';

/** @param {ReturnType<import('../services/fileService.js').createFileService>} fileService */
export function createFilesRouter(fileService) {
  const router = Router();

  /**
   * GET /api/files?location=OneDrive|SharePoint&user=u01
   * Lists all drive items (inspection/debug endpoint for the simulation).
   */
  router.get('/', (req, res) => {
    const { location } = req.query;
    if (location !== undefined && !Object.values(LOCATIONS).includes(location)) {
      throw new HttpError(400, "'location' moet 'OneDrive' of 'SharePoint' zijn.");
    }
    const files = fileService.listFiles({ location, userId: optionalUserId(req.query.user, 'user') });
    res.json({ count: files.length, files });
  });

  /**
   * GET /api/files/scan-onedrive?user=u01&includeSnoozed=true
   * Migration candidates: OneDrive files with share_count > 2.
   */
  router.get('/scan-onedrive', (req, res) => {
    res.json(
      fileService.scanOneDrive({
        userId: optionalUserId(req.query.user, 'user'),
        includeSnoozed: req.query.includeSnoozed === 'true',
      })
    );
  });

  /**
   * POST /api/files/migrate-to-sharepoint
   * Body: { "fileId": 12, "userId": "u01" }   (userId optional, defaults to owner)
   */
  router.post('/migrate-to-sharepoint', (req, res) => {
    const body = req.body ?? {};
    const result = fileService.migrateToSharePoint({
      fileId: requirePositiveInt(body.fileId, 'fileId'),
      userId: optionalUserId(body.userId),
    });
    res.json(result);
  });

  /**
   * POST /api/files/decline
   * Body: { "fileId": 12, "userId": "u01" }
   * Records a "Nu niet" answer. Nothing is moved.
   */
  router.post('/decline', (req, res) => {
    const body = req.body ?? {};
    const result = fileService.declineMigration({
      fileId: requirePositiveInt(body.fileId, 'fileId'),
      userId: optionalUserId(body.userId),
    });
    res.status(201).json(result);
  });

  return router;
}
