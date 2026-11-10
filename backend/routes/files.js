/**
 * @file routes/files.js
 * @description HTTP layer of the Action Hub. Routes only parse/validate input
 * and pick status codes (thin controller pattern); logic lives in
 * services/actionHubService.js. All routes require authentication.
 */

import { Router } from 'express';
import { optionalId, requireContentHash, requirePositiveInt } from '../errors.js';

/** Optional positive integer (e.g. a folder id). */
const optionalPositiveInt = (value, field) => (value === undefined || value === null ? undefined : requirePositiveInt(value, field));

/** @param {ReturnType<import('../services/actionHubService.js').createActionHubService>} hub */
export function createFilesRouter(hub) {
  const router = Router();

  /** GET /api/files/scan-onedrive: own OneDrive files with times_shared > 2 (not snoozed). */
  router.get('/scan-onedrive', (req, res) => res.json(hub.scanOneDrive(req.actor)));

  /** GET /api/files/onedrive: all own OneDrive files (Bestanden tab, left column). */
  router.get('/onedrive', (req, res) => res.json(hub.listOneDrive(req.actor)));

  /** GET /api/files/actions: the action list of the Actie-hub. */
  router.get('/actions', (req, res) => res.json(hub.actionSummary(req.actor)));

  /** GET /api/files/mine: own active files (OneDrive + SharePoint). */
  router.get('/mine', (req, res) => res.json(hub.listMine(req.actor)));

  /** GET /api/files/duplicate-chains: bit-identical copies involving the user. */
  router.get('/duplicate-chains', (req, res) => res.json(hub.duplicateChains(req.actor)));

  /** POST /api/files/migrate-to-sharepoint  { fileId, siteId?, folderId? } */
  router.post('/migrate-to-sharepoint', (req, res) => {
    res.json(hub.migrateToSharePoint(req.actor, {
      fileId: requirePositiveInt(req.body?.fileId, 'fileId'),
      siteId: optionalId(req.body?.siteId, 'siteId'),
      folderId: optionalPositiveInt(req.body?.folderId, 'folderId'),
    }));
  });

  /** POST /api/files/snooze  { fileId }  ("Nu niet") */
  router.post('/snooze', (req, res) => {
    res.status(201).json(hub.snooze(req.actor, { fileId: requirePositiveInt(req.body?.fileId, 'fileId') }));
  });

  /** POST /api/files/consolidate-duplicates  { contentHash, confirmed: true } */
  router.post('/consolidate-duplicates', (req, res) => {
    res.json(hub.consolidateDuplicates(req.actor, {
      contentHash: requireContentHash(req.body?.contentHash),
      confirmed: req.body?.confirmed,
    }));
  });

  /** POST /api/files/:id/restore: undo a clean-up (recycle bin -> OneDrive). */
  router.post('/:id/restore', (req, res) => {
    res.json(hub.restore(req.actor, { fileId: requirePositiveInt(req.params.id, 'id') }));
  });

  return router;
}
