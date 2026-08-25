import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig } from '../support/factories.js';
import { legalRouter } from '../../src/web/routes/legal.js';
import express from 'express';
import { request } from '../support/app.js';

function setup() {
  const config = testConfig();
  const app = express();
  app.use(legalRouter({ config }));
  return { app, config };
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

test('the support page links back to the privacy notice and the support address', async () => {
  const { app, config } = setup();
  const body = await (await request(app, '/support')).text();
  assert.match(body, /\/privacy/);
  assert.match(body, new RegExp(config.supportEmail));
});
