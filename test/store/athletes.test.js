import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';

test('insert defaults to active on the shared message', () => {
  const db = testDb();
  const athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (makeAthlete(db));
  assert.equal(athlete.status, 'active');
  assert.equal(athlete.message, null);
  assert.equal(athlete.processed_count, 0);
});

test('get returns undefined for an unknown athlete', () => {
  assert.equal(createAthleteStore(testDb()).get(404404), undefined);
});

test('updateTokens replaces all three token fields', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);
  store.updateTokens(987654, { accessToken: 'a2', refreshToken: 'r2', expiresAt: 123 });
  const athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.access_token, 'a2');
  assert.equal(athlete.refresh_token, 'r2');
  assert.equal(athlete.expires_at, 123);
});

test('setMessage stores text and stamps the timestamp; null reverts to the default', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);

  store.setMessage(987654, 'my own words', NOW);
  let athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.message, 'my own words');
  athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.message_updated_at, NOW);

  store.setMessage(987654, null, NOW + 5);
  athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.message, null);
});

test('advanceCutoff moves forward but never backwards', () => {
  const db = testDb();
  makeAthlete(db, { activityCutoff: 1000 });
  const store = createAthleteStore(db);

  store.advanceCutoff(987654, 2000);
  let athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.activity_cutoff, 2000);
  store.advanceCutoff(987654, 500);
  athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.activity_cutoff, 2000);
  store.advanceCutoff(987654, 2000);
  athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.activity_cutoff, 2000);
});

test('markRevoked and reactivate flip status', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);

  store.markRevoked(987654, NOW);
  let athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.status, 'revoked');
  athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.revoked_at, NOW);

  store.reactivate(987654, { accessToken: 'a3', refreshToken: 'r3', expiresAt: 999 });
  athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.status, 'active');
  assert.equal(athlete.revoked_at, null);
  assert.equal(athlete.access_token, 'a3');
});

test('recordSuccess bumps the counter and clears the last error', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);

  store.recordError(987654, 'boom', NOW);
  store.recordSuccess(987654, 555, NOW + 10);

  const athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.processed_count, 1);
  assert.equal(athlete.last_activity_id, 555);
  assert.equal(athlete.last_processed_at, NOW + 10);
  assert.equal(athlete.last_error, null);
  assert.equal(athlete.last_error_at, null);
});

test('recordError truncates a very long message rather than bloating the row', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);
  store.recordError(987654, 'x'.repeat(5000), NOW);
  const athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.ok(athlete.last_error !== null && athlete.last_error.length <= 500);
});

test('list and countActive support an owner view', () => {
  const db = testDb();
  makeAthlete(db, { athleteId: 1 });
  makeAthlete(db, { athleteId: 2 });
  const store = createAthleteStore(db);
  store.markRevoked(2, NOW);

  assert.equal(store.list().length, 2);
  assert.equal(store.countActive(), 1);
});

test('remove permanently deletes the athlete row', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createAthleteStore(db);

  store.remove(987654);
  assert.equal(store.get(987654), undefined);
});

test('remove on an unknown athlete is a no-op, not an error', () => {
  const db = testDb();
  const store = createAthleteStore(db);
  assert.doesNotThrow(() => store.remove(404404));
});

test('insert on an existing athlete refreshes tokens and reactivates, preserving their message and cutoff', () => {
  const db = testDb();
  makeAthlete(db, { message: 'mine', activityCutoff: 5000 });
  const store = createAthleteStore(db);
  store.markRevoked(987654, NOW);

  store.insert({
    athleteId: 987654, name: 'Test Athlete', refreshToken: 'r9', accessToken: 'a9',
    expiresAt: NOW + 100, message: null, activityCutoff: 1, now: NOW,
  });

  const athlete = /** @type {import('../../src/ports/index.js').Athlete} */ (store.get(987654));
  assert.equal(athlete.status, 'active');
  assert.equal(athlete.access_token, 'a9');
  assert.equal(athlete.message, 'mine', 'a reconnect must not silently wipe their message');
  assert.equal(athlete.activity_cutoff, 5000, 'and must not move the cutoff backwards');
});
