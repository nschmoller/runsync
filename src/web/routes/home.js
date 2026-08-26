import express from 'express';
import { renderHomePage } from '../views/home.js';
import { headerContext } from '../viewHelpers.js';

/** @param {{config:any,sessions:any,clock:import('../../ports/index.js').Clock}} deps */
export function homeRouter({ config, sessions, clock }) {
  const router = express.Router();
  router.get('/', (req, res) => res.type('html').send(renderHomePage(headerContext(req, { config, sessions, clock }))));
  return router;
}
