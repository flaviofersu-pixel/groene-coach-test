/**
 * @file routes/user.js
 * @description Profile and the SharePoint Mapper ("Snelkoppeling toevoegen aan Mijn bestanden").
 */

import { Router } from 'express';
import { optionalId } from '../errors.js';

/** @param {ReturnType<import('../services/userService.js').createUserService>} users */
export function createUserRouter(users) {
  const router = Router();

  /** GET /api/user/me: profile, granted scopes, site memberships. */
  router.get('/me', (req, res) => res.json(users.me(req.actor)));

  /** POST /api/user/map-sharepoint-shortcut  { siteId? }  (default: own department site) */
  router.post('/map-sharepoint-shortcut', (req, res) => {
    const result = users.mapSharePointShortcut(req.actor, { siteId: optionalId(req.body?.siteId, 'siteId') });
    res.status(result.created ? 201 : 200).json(result);
  });

  /** GET /api/user/sharepoint-tree: folders of the user's team sites (Bestanden tab, right window). */
  router.get('/sharepoint-tree', (req, res) => res.json(users.sharePointTree(req.actor)));

  /** GET /api/user/explorer-view: before/after trees for the Explorer preview. */
  router.get('/explorer-view', (req, res) => res.json(users.explorerView(req.actor)));

  return router;
}
