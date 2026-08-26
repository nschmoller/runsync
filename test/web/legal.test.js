import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig, fixedClock, NOW } from '../support/factories.js';
import { legalRouter } from '../../src/web/routes/legal.js';
import { createSessions } from '../../src/web/session.js';
import express from 'express';
import { request } from '../support/app.js';

function setup() {
  const config = testConfig();
  const sessions = createSessions(config.sessionSecret);
  const app = express();
  app.use(legalRouter({ config, sessions, clock: fixedClock(NOW) }));
  return { app, config, sessions };
}

test('the privacy page discloses collection, purpose, storage, and deletion', async () => {
  const { app, config } = setup();
  const body = await (await request(app, '/privacy')).text();
  assert.match(body, /athlete id and name/i);
  assert.match(body, /OAuth/);
  assert.match(body, /7 days/);
  assert.match(body, new RegExp(config.supportEmail));
  assert.match(body, /dashboard/);
});

test('the privacy page header shows a dashboard link when a valid session cookie is present', async () => {
  const { app, sessions } = setup();
  const cookie = `${sessions.COOKIE_NAME}=${encodeURIComponent(sessions.sign(987654, NOW + 60))}`;
  const body = await (await request(app, '/privacy', { headers: { cookie } })).text();
  assert.match(body, /href="\/dashboard"[^>]*>Dashboard</);
});

test('the support page links back to the privacy notice and the support address', async () => {
  const { app, config } = setup();
  const body = await (await request(app, '/support')).text();
  assert.match(body, /\/privacy/);
  assert.match(body, new RegExp(config.supportEmail));
});
