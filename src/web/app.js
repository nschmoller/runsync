import express from 'express';
import { webhookRouter } from './routes/webhook.js';
import { connectRouter } from './routes/connect.js';
import { oauthRouter } from './routes/oauth.js';
import { createAuth } from './middleware/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { legalRouter } from './routes/legal.js';
/** @param {any} container */
export function createApp(container) { const { config, athleteStore, activityStore, inviteStore, authStateStore, dispatcher, sessions, connectService, athleteService, dataDeletionService, clock, logger } = container; const app = express(); app.disable('x-powered-by'); app.set('trust proxy', true); app.use(express.json()); app.use(express.urlencoded({ extended: false })); app.use((/** @type {any} */ error, /** @type {any} */ req, /** @type {any} */ _res, /** @type {any} */ next) => { if (error?.type === 'entity.parse.failed') { logger.warn('http.bad-body', { path: req.path }); req.body = {}; } next(); }); app.use(webhookRouter({ config, athleteStore, activityStore, dataDeletionService, dispatcher, clock, logger })); app.use(connectRouter({ config, inviteStore, authStateStore, clock, logger })); app.use(oauthRouter({ connectService, sessions, clock, logger })); app.use(dashboardRouter({ config, auth:createAuth({sessions,athleteStore,config,clock,logger}), activityStore, athleteService, dataDeletionService, sessions, logger })); app.use(legalRouter({ config })); app.get('/healthz', (_req, res) => res.json({ ok: true })); return app; }
