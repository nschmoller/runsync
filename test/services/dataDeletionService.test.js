import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createDataDeletionService } from '../../src/services/dataDeletionService.js';

/** @param {(token: string) => Promise<void>} [deauthorize] */
function setup(deauthorize = async () => {}) {
  const db = testDb();
  makeAthlete(db);
  const athleteStore = createAthleteStore(db);
  const activityStore = createActivityStore(db);
  const calls = /** @type {string[]} */ ([]);
  const logger = collectingLogger();
  const service = createDataDeletionService({
    db, athleteStore, activityStore,
    strava: { async deauthorize(token) { calls.push(token); return deauthorize(token); } },
    logger,
  });
  return { db, athleteStore, activityStore, service, calls, logger };
}

test('deletes the athlete row and their processed activities', async () => {
  const { athleteStore, activityStore, service } = setup();
  activityStore.markProcessed(555, 987654, NOW);

  await service.deleteAthleteData(987654, { reason: 'user-request' });

  assert.equal(athleteStore.get(987654), undefined);
  assert.equal(activityStore.isProcessed(555), false);
});

test('deletes local data even when Strava deauthorization fails', async () => {
  const { athleteStore, service, calls, logger } = setup(async () => { throw new Error('upstream down'); });

  await service.deleteAthleteData(987654);

  assert.deepEqual(calls, ['access-1']);
  assert.equal(athleteStore.get(987654), undefined);
  assert.ok(logger.entries.some((/** @type {any} */ e) => e.event === 'athlete.deauthorize-failed'));
});

test('is idempotent — deleting an already-deleted athlete is a no-op', async () => {
  const { athleteStore, service, calls } = setup();
  await service.deleteAthleteData(987654);
  await service.deleteAthleteData(987654);

  assert.equal(athleteStore.get(987654), undefined);
  assert.deepEqual(calls, ['access-1'], 'the second call must not attempt deauthorization again');
});

test('logs the deletion with athlete id and reason', async () => {
  const { service, logger } = setup();
  await service.deleteAthleteData(987654, { reason: 'deauthorized' });
  assert.ok(logger.entries.some((/** @type {any} */ e) =>
    e.event === 'athlete.data-deleted' && e.athleteId === 987654 && e.reason === 'deauthorized'));
});

test('leaves another athlete untouched', async () => {
  const { db, athleteStore, activityStore, service } = setup();
  makeAthlete(db, { athleteId: 111 });
  activityStore.markProcessed(1, 111, NOW);

  await service.deleteAthleteData(987654);

  assert.ok(athleteStore.get(111));
  assert.equal(activityStore.isProcessed(1), true);
});
