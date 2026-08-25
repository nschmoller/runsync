import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, testConfig, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createActivityProcessor } from '../../src/services/activityProcessor.js';
import { createDataDeletionService } from '../../src/services/dataDeletionService.js';
import { activityJob } from '../../src/services/jobs.js';
import { StravaError } from '../../src/adapters/strava/errors.js';

const AFTER_CUTOFF = '2027-02-01T07:00:00Z';
const BEFORE_CUTOFF = '2020-01-01T00:00:00Z';
const RUN = { id: 555, sport_type: 'Run', start_date: AFTER_CUTOFF, description: 'Great run!' };

/**
 * @typedef {object} SetupOptions
 * @property {import('../../src/ports/index.js').Activity} [activity]
 * @property {Partial<import('../../src/ports/index.js').Athlete>} [athlete]
 * @property {Partial<import('../../src/ports/index.js').Config>} [config]
 * @property {(token: string, activityId: number) => Promise<import('../../src/ports/index.js').Activity>|import('../../src/ports/index.js').Activity} [getActivity]
 * @property {(token: string, activityId: number, patch: {description: string}) => Promise<void>|void} [updateActivity]
 */

/** @param {SetupOptions} [options] */
function setup({ activity = RUN, athlete = {}, config = {}, getActivity, updateActivity } = {}) {
  const db = testDb();
  makeAthlete(db, athlete);
  const athleteStore = createAthleteStore(db);
  const activityStore = createActivityStore(db);
  const logger = collectingLogger();
  const calls = /** @type {{get: number, put: number, token: number, updates: Array<{id: number, description: string}>}} */
    ({ get: 0, put: 0, token: 0, updates: [] });

  /** @type {Pick<import('../../src/ports/index.js').StravaClient, 'getActivity'|'updateActivity'>} */
  const strava = {
    async getActivity(token, id) {
      calls.get += 1;
      if (getActivity) return getActivity(token, id);
      return activity;
    },
    async updateActivity(token, id, patch) {
      calls.put += 1;
      calls.updates.push({ id, ...patch });
      if (updateActivity) return updateActivity(token, id, patch);
    },
  };
  /** @type {import('../../src/ports/index.js').TokenProvider} */
  const tokens = { async accessTokenFor(_athlete) { calls.token += 1; return 'token'; } };
  const dataDeletionService = createDataDeletionService({
    db, athleteStore, activityStore, strava: { async deauthorize() {} }, logger,
  });

  const processor = createActivityProcessor({
    athleteStore, activityStore, strava, tokens, dataDeletionService,
    config: testConfig(config), clock: fixedClock(NOW), logger,
  });

  return { processor, athleteStore, activityStore, calls, logger };
}

test('appends the message to a run after the cutoff', async () => {
  const { processor, athleteStore, activityStore, calls } = setup();
  assert.equal(await processor.process(activityJob(987654, 555)), 'appended');

  assert.equal(calls.put, 1);
  assert.deepEqual(calls.updates, [{ id: 555, description: 'Great run!\n\n🏃 Synced via runsync' }]);
  assert.equal(activityStore.isProcessed(555), true);

  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  assert.equal(athlete.processed_count, 1);
  assert.equal(athlete.last_activity_id, 555);
  assert.equal(athlete.last_processed_at, NOW);
});

test('uses the athlete own message', async () => {
  const { processor, calls } = setup({ athlete: { message: 'Powered by stubbornness' } });
  await processor.process(activityJob(987654, 555));
  assert.deepEqual(calls.updates, [{ id: 555, description: 'Great run!\n\nPowered by stubbornness' }]);
});

test('drops an unknown athlete without spending a request', async () => {
  const { processor, calls } = setup();
  assert.equal(await processor.process(activityJob(404404, 555)), 'unknown-athlete');
  assert.equal(calls.token, 0);
  assert.equal(calls.get, 0);
});

test('drops a revoked athlete without spending a request', async () => {
  const { processor, athleteStore, calls } = setup();
  athleteStore.markRevoked(987654, NOW);
  assert.equal(await processor.process(activityJob(987654, 555)), 'revoked');
  assert.equal(calls.get, 0);
});

test('an already-processed activity costs no Strava request at all', async () => {
  const { processor, activityStore, calls } = setup();
  activityStore.markProcessed(555, 987654, NOW);

  assert.equal(await processor.process(activityJob(987654, 555)), 'already-processed');
  assert.equal(calls.token, 0, 'the processed check must run before the token, protecting the rate limit');
  assert.equal(calls.get, 0);
  assert.equal(calls.put, 0);
});

test('drops an activity before the cutoff — the old-activity-edit leak', async () => {
  const { processor, calls } = setup({ activity: { ...RUN, start_date: BEFORE_CUTOFF } });
  assert.equal(await processor.process(activityJob(987654, 555)), 'before-cutoff');
  assert.equal(calls.put, 0);
});

test('drops a sport outside SPORT_TYPES', async () => {
  const { processor, calls } = setup({ activity: { ...RUN, sport_type: 'Ride' } });
  assert.equal(await processor.process(activityJob(987654, 555)), 'wrong-sport');
  assert.equal(calls.put, 0);
});

test('a skipped activity is not recorded as processed, so a later fix can still pick it up', async () => {
  const { processor, activityStore } = setup({ activity: { ...RUN, sport_type: 'Ride' } });
  await processor.process(activityJob(987654, 555));
  assert.equal(activityStore.isProcessed(555), false);
});

test('back-fills the record without a PUT when the description already has the message', async () => {
  const { processor, activityStore, calls } = setup({
    activity: { ...RUN, description: 'Great run!\n\n🏃 Synced via runsync' },
  });
  assert.equal(await processor.process(activityJob(987654, 555)), 'backfill');
  assert.equal(calls.put, 0);
  assert.equal(activityStore.isProcessed(555), true);
});

test('does not append twice when the athlete typed text after the message', async () => {
  const { processor, calls } = setup({
    activity: { ...RUN, description: '🏃 Synced via runsync\n\nsplit negative!' },
  });
  assert.equal(await processor.process(activityJob(987654, 555)), 'backfill');
  assert.equal(calls.put, 0);
});

test('records and logs the error before rethrowing when Strava fails', async () => {
  const { processor, athleteStore, activityStore, logger } = setup({
    getActivity: () => { throw new StravaError(429, 'Rate Limit Exceeded'); },
  });

  await assert.rejects(() => processor.process(activityJob(987654, 555)), /429/);

  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  assert.ok(athlete.last_error);
  assert.match(athlete.last_error, /429/);
  assert.equal(athlete.last_error_at, NOW);
  assert.equal(activityStore.isProcessed(555), false, 'a failed activity must stay unprocessed');
  assert.ok(logger.entries.some((/** @type {any} */ entry) =>
    entry.event === 'activity.failed' && entry.athleteId === 987654 && entry.activityId === 555 && /429/.test(entry.error)));
});

test('a failure after the PUT still records the activity, so it is never appended twice', async () => {
  const { processor, activityStore } = setup({
    updateActivity: () => { throw new StravaError(500, 'boom'); },
  });
  await assert.rejects(() => processor.process(activityJob(987654, 555)));
  assert.equal(activityStore.isProcessed(555), false,
    'the PUT never landed, so the activity must remain eligible');
});

test('an unknown athlete failing does not try to record an error on a missing row', async () => {
  const { processor } = setup({ getActivity: () => { throw new StravaError(500, 'boom'); } });
  await assert.doesNotReject(() => processor.process(activityJob(404404, 555)));
});

test('logs the outcome with athlete and activity ids', async () => {
  const { processor, logger } = setup();
  await processor.process(activityJob(987654, 555));
  assert.ok(logger.entries.some((/** @type {any} */ e) =>
    e.event === 'activity.appended' && e.athleteId === 987654 && e.activityId === 555));
});

test('a 401 from Strava deletes the athlete\'s data, not just logs it', async () => {
  const { processor, athleteStore } = setup({
    getActivity: () => { throw new StravaError(401, 'Unauthorized'); },
  });

  await assert.rejects(() => processor.process(activityJob(987654, 555)), /401/);

  assert.equal(athleteStore.get(987654), undefined, 'a dead token must not leave data behind');
});
