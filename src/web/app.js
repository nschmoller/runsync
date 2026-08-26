import express from 'express';
import path from 'node:path';
import { webhookRouter } from './routes/webhook.js';
import { connectRouter } from './routes/connect.js';
import { oauthRouter } from './routes/oauth.js';
import { createAuth } from './middleware/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { legalRouter } from './routes/legal.js';
import { homeRouter } from './routes/home.js';
import { devAuthRouter } from './routes/devAuth.js';
/** @param {any} container */
export function createApp(container) { const { config, athleteStore, activityStore, inviteStore, authStateStore, dispatcher, sessions, connectService, athleteService, dataDeletionService, clock, logger } = container; const app = express(); app.disable('x-powered-by'); app.set('trust proxy', true); app.use(express.json()); app.use(express.urlencoded({ extended: false })); app.use((/** @type {any} */ error, /** @type {any} */ req, /** @type {any} */ _res, /** @type {any} */ next) => { if (error?.type === 'entity.parse.failed') { logger.warn('http.bad-body', { path: req.path }); req.body = {}; } next(); }); app.use(webhookRouter({ config, athleteStore, activityStore, dataDeletionService, dispatcher, clock, logger })); app.use(connectRouter({ config, inviteStore, authStateStore, sessions, clock, logger })); app.use(oauthRouter({ connectService, sessions, clock, logger })); app.use(devAuthRouter({ config, athleteStore, sessions, clock, logger })); app.use(dashboardRouter({ config, auth:createAuth({sessions,athleteStore,config,clock,logger}), activityStore, athleteService, dataDeletionService, sessions, logger })); app.use(legalRouter({ config, sessions, clock })); app.use(homeRouter({ config, sessions, clock })); app.get('/app-icon.png', (_req, res) => res.sendFile(path.resolve('app-icon.png'))); app.get('/logo-schmoller.svg', (_req, res) => res.sendFile(path.resolve('logo-schmoller.svg'))); app.get('/healthz', (_req, res) => res.json({ ok: true })); return app; }
