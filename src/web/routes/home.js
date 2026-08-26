import express from 'express';
import { renderHomePage } from '../views/home.js';
import { loginHref } from '../../domain/localDev.js';

/** @param {{config:any}} deps */
export function homeRouter({ config }) {
  const router = express.Router();
  router.get('/', (_req, res) => res.type('html').send(renderHomePage({ loginHref: loginHref(config) })));
  return router;
}
