import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, testConfig, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createInviteStore } from '../../src/adapters/store/invites.js';
import { createAuthStateStore } from '../../src/adapters/store/authStates.js';
import { createConnectService } from '../../src/services/connectService.js';
import { ConflictError } from '../../src/domain/errors.js';

const RIDE = { id: 900, sport_type: 'Ride', start_date: '2027-01-20T10:00:00Z' };
const RUN = { id: 800, sport_type: 'Run', start_date: '2027-01-18T06:00:00Z', description: 'Long one' };
/** @param {string} iso */
const timestamp = (iso) => Math.floor(new Date(iso).getTime() / 1000);

function setup(activities = [RIDE, RUN]) {
  const db = testDb();
  const athletes = createAthleteStore(db);
  const stores = { athletes, activities: createActivityStore(db), invites: createInviteStore(db), authStates: createAuthStateStore(db) };
  const calls = /** @type {{list: number, put: Array<{id:number,description:string}>}} */ ({ list: 0, put: [] });
  /** @type {import('../../src/ports/index.js').StravaClient} */
  const strava = {
    async exchangeCode() { return { athleteId: 987654, name: 'Test Athlete', accessToken: 'a1', refreshToken: 'r1', expiresAt: NOW + 21_600 }; },
    async refresh() { throw new Error('not used'); },
    async getActivity(_token, id) { const activity = activities.find((item) => item.id === id); assert.ok(activity); return activity; },
    async updateActivity(_token, id, patch) { calls.put.push({ id, ...patch }); },
    async listRecentActivities(_token, _perPage) { calls.list += 1; return activities; },
    async deauthorize() {},
  };
  const service = createConnectService({ athleteStore: stores.athletes, activityStore: stores.activities, inviteStore: stores.invites, authStateStore: stores.authStates, strava, config: testConfig(), clock: fixedClock(NOW), logger: collectingLogger() });
  return { db, stores, service, calls };
}

/** @param {{invites: import('../../src/ports/index.js').InviteStore, authStates: import('../../src/ports/index.js').AuthStateStore}} stores @param {{state?: string, invite?: string, message?: string|null}} [options] */
function stage(stores, { state = 'state', invite = 'invite', message = null } = {}) {
  stores.invites.create({ token: invite, now: NOW, expiresAt: NOW + 604800 });
  stores.authStates.create({ state, inviteToken: invite, pendingMessage: message, now: NOW, expiresAt: NOW + 600 });
  return state;
}

test('first connect consumes the invite, persists the chosen message, and seeds only the newest run', async () => {
  const { stores, service, calls } = setup();
  assert.deepEqual(await service.completeConnect({ code: 'code', state: stage(stores, { message: 'Mine' }) }), { athleteId: 987654, isNew: true });
  const athlete = stores.athletes.get(987654);
  assert.ok(athlete);
  assert.equal(athlete.message, 'Mine');
  assert.equal(athlete.activity_cutoff, timestamp(RIDE.start_date));
  assert.equal(athlete.seed_activity_id, RUN.id);
  assert.deepEqual(calls.put, [{ id: RUN.id, description: 'Long one\n\nMine' }]);
  assert.equal(stores.activities.isProcessed(RUN.id), true);
  assert.equal(stores.invites.getUsable('invite', NOW), undefined);
});

test('a missing or replayed state is refused', async () => {
  const { stores, service } = setup();
  await assert.rejects(() => service.completeConnect({ code: 'c', state: 'missing' }), ConflictError);
  const state = stage(stores);
  await service.completeConnect({ code: 'c', state });
  await assert.rejects(() => service.completeConnect({ code: 'c', state }), ConflictError);
});

test('login only reauthenticates an existing athlete and never reseeds', async () => {
  const { db, stores, service, calls } = setup();
  makeAthlete(db, { activityCutoff: 1000 });
  stores.authStates.create({ state: 'login', inviteToken: null, pendingMessage: null, now: NOW, expiresAt: NOW + 600 });
  assert.deepEqual(await service.completeConnect({ code: 'c', state: 'login' }), { athleteId: 987654, isNew: false });
  assert.equal(calls.list, 0);
  assert.equal(stores.athletes.get(987654)?.activity_cutoff, 1000);
});

test('a failed seed leaves the athlete connected', async () => {
  const { stores } = setup();
  /** @type {import('../../src/ports/index.js').StravaClient} */
  const strava = {
    async exchangeCode() { return { athleteId: 987654, name: 'Test Athlete', accessToken: 'a1', refreshToken: 'r1', expiresAt: NOW }; },
    async refresh() { throw new Error('not used'); }, async getActivity() { throw new Error('not used'); },
    async updateActivity() {}, async listRecentActivities() { throw new Error('Strava unavailable'); }, async deauthorize() {},
  };
  const service = createConnectService({ athleteStore: stores.athletes, activityStore: stores.activities, inviteStore: stores.invites, authStateStore: stores.authStates, strava, config: testConfig(), clock: fixedClock(NOW), logger: collectingLogger() });
  await service.completeConnect({ code: 'c', state: stage(stores) });
  assert.ok(stores.athletes.get(987654));
});
