import express from 'express';
import { renderPrivacyPage, renderSupportPage } from '../views/legal.js';

/** @param {{config: import('../../ports/index.js').Config}} deps */
export function legalRouter({ config }) {
  const router = express.Router();
  router.get('/privacy', (_req, res) => res.type('html').send(renderPrivacyPage({ config })));
  router.get('/support', (_req, res) => res.type('html').send(renderSupportPage({ config })));
  return router;
}
