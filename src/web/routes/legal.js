import express from 'express';
import { renderPrivacyPage, renderSupportPage } from '../views/legal.js';
import { headerContext } from '../viewHelpers.js';

/** @param {{config: import('../../ports/index.js').Config, sessions:any, clock:import('../../ports/index.js').Clock}} deps */
export function legalRouter({ config, sessions, clock }) {
  const router = express.Router();
  router.get('/privacy', (req, res) => res.type('html').send(renderPrivacyPage({ config, ...headerContext(req, { config, sessions, clock }) })));
  router.get('/support', (req, res) => res.type('html').send(renderSupportPage({ config, ...headerContext(req, { config, sessions, clock }) })));
  return router;
}
