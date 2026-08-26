// @ts-nocheck
import { test } from 'node:test'; import assert from 'node:assert/strict'; import { testDb,testConfig,fixedClock,collectingLogger,NOW } from '../support/factories.js'; import { createAthleteStore } from '../../src/adapters/store/athletes.js'; import { createActivityStore } from '../../src/adapters/store/activities.js'; import { createInviteStore } from '../../src/adapters/store/invites.js'; import { createAuthStateStore } from '../../src/adapters/store/authStates.js'; import { createSessions } from '../../src/web/session.js'; import { createApp } from '../../src/web/app.js'; import { request,form } from '../support/app.js';

function setup() {
  const db = testDb(), config = testConfig(), athleteStore = createAthleteStore(db), activityStore = createActivityStore(db), invites = createInviteStore(db), authStates = createAuthStateStore(db), sessions = createSessions(config.sessionSecret), logger = collectingLogger();
  const sent = [];
  const mailer = { async send(input) { sent.push(input); } };
  const app = createApp({ config, athleteStore, activityStore, inviteStore: invites, authStateStore: authStates, dispatcher: { dispatch(){}, drain: async()=>{} }, sessions, connectService: {}, athleteService: {}, dataDeletionService: {}, mailer, clock: fixedClock(NOW), logger });
  return { app, config, sent };
}

test('POST /request-invite with valid input sends mail to the support address and shows a success message', async () => {
  const { app, config, sent } = setup();
  const response = await request(app, '/request-invite', form({ name: 'Ada Lovelace', email: 'ada@example.com' }));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /thanks/i);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, config.supportEmail);
  assert.match(sent[0].subject, /invite/i);
  assert.match(sent[0].text, /Ada Lovelace/);
  assert.match(sent[0].text, /ada@example\.com/);
});

test('POST /request-invite with an invalid email is rejected and sends no mail', async () => {
  const { app, sent } = setup();
  const response = await request(app, '/request-invite', form({ name: 'Ada', email: 'not-an-email' }));
  assert.equal(response.status, 400);
  const body = await response.text();
  assert.match(body, /valid email/i);
  assert.match(body, /value="Ada"/, 'the name must survive the error re-render');
  assert.equal(sent.length, 0);
});

test('POST /request-invite with a blank name is rejected and sends no mail', async () => {
  const { app, sent } = setup();
  const response = await request(app, '/request-invite', form({ name: '', email: 'ada@example.com' }));
  assert.equal(response.status, 400);
  assert.equal(sent.length, 0);
});

test('POST /request-invite with the honeypot field filled in reports success but sends no mail', async () => {
  const { app, sent } = setup();
  const response = await request(app, '/request-invite', form({ name: 'Bot', email: 'bot@example.com', company: 'Acme' }));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /thanks/i);
  assert.equal(sent.length, 0);
});

test('POST /request-invite shows an error and no crash when sending mail fails', async () => {
  const db = testDb(), config = testConfig(), athleteStore = createAthleteStore(db), activityStore = createActivityStore(db), invites = createInviteStore(db), authStates = createAuthStateStore(db), sessions = createSessions(config.sessionSecret), logger = collectingLogger();
  const mailer = { async send() { throw new Error('smtp exploded'); } };
  const app = createApp({ config, athleteStore, activityStore, inviteStore: invites, authStateStore: authStates, dispatcher: { dispatch(){}, drain: async()=>{} }, sessions, connectService: {}, athleteService: {}, dataDeletionService: {}, mailer, clock: fixedClock(NOW), logger });
  const response = await request(app, '/request-invite', form({ name: 'Ada', email: 'ada@example.com' }));
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.match(body, /went wrong/i);
});
