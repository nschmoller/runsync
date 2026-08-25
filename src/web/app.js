import express from 'express';
import { webhookRouter } from './routes/webhook.js';
/** @param {any} container */
export function createApp(container) { const { config, athleteStore, activityStore, dispatcher, clock, logger } = container; const app = express(); app.disable('x-powered-by'); app.set('trust proxy', true); app.use(express.json()); app.use(express.urlencoded({ extended: false })); app.use((/** @type {any} */ error, /** @type {any} */ req, /** @type {any} */ _res, /** @type {any} */ next) => { if (error?.type === 'entity.parse.failed') { logger.warn('http.bad-body', { path: req.path }); req.body = {}; } next(); }); app.use(webhookRouter({ config, athleteStore, activityStore, dispatcher, clock, logger })); app.get('/healthz', (_req, res) => res.json({ ok: true })); return app; }
