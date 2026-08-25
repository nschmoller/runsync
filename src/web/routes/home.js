import express from 'express';
import { renderHomePage } from '../views/home.js';

export function homeRouter() {
  const router = express.Router();
  router.get('/', (_req, res) => res.type('html').send(renderHomePage()));
  return router;
}
