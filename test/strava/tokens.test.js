import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, fixedClock, collectingLogger, NOW } from '../support/factories.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';
import { createTokenProvider, REFRESH_SKEW_SECONDS } from '../../src/adapters/strava/tokens.js';
import { createDataDeletionService } from '../../src/services/dataDeletionService.js';
import { StravaError } from '../../src/adapters/strava/errors.js';

/**
 * @param {{ refresh?: (token: string, count: number) => Promise<any>, athlete?: Record<string,any> }} [opts]
 */
function setup({ refresh, athlete = {} } = {}) {
  const db = testDb();
  makeAthlete(db, athlete);
  const athleteStore = createAthleteStore(db);
  const activityStore = createActivityStore(db);
  const calls = { refresh: 0, tokens: /** @type {string[]} */ ([]) };
  const logger = collectingLogger();

  /** @type {any} */
  const client = {
    /** @param {string} refreshToken */
    async refresh(refreshToken) {
      calls.refresh += 1;
      calls.tokens.push(refreshToken);
      if (refresh) return refresh(refreshToken, calls.refresh);
      return { accessToken: `access-${calls.refresh + 1}`, refreshToken: `refresh-${calls.refresh + 1}`, expiresAt: NOW + 21_600 };
    },
  };

  const dataDeletionService = createDataDeletionService({
    db, athleteStore, activityStore, strava: { async deauthorize() {} }, logger,
  });
  const tokens = createTokenProvider({ client, athleteStore, dataDeletionService, clock: fixedClock(NOW), logger });
  return { athleteStore, tokens, calls, logger };
}

test('returns the stored token when it is comfortably fresh', async () => {
  const { athleteStore, tokens, calls } = setup({ athlete: { accessToken: 'still-good', expiresAt: NOW + 3600 } });
  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  assert.equal(await tokens.accessTokenFor(athlete), 'still-good');
  assert.equal(calls.refresh, 0);
});

test('refreshes inside the skew window, before the token has actually expired', async () => {
  const { athleteStore, tokens, calls } = setup({
    athlete: { accessToken: 'stale', expiresAt: NOW + REFRESH_SKEW_SECONDS - 1 },
  });
  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  assert.equal(await tokens.accessTokenFor(athlete), 'access-2');
  assert.equal(calls.refresh, 1);
});

test('persists the rotated token pair, not just the access token', async () => {
  const { athleteStore, tokens } = setup({ athlete: { refreshToken: 'refresh-1', expiresAt: NOW + 60 } });
  let initial = athleteStore.get(987654);
  assert.ok(initial);
  await tokens.accessTokenFor(initial);

  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  assert.equal(athlete.access_token, 'access-2');
  assert.equal(athlete.refresh_token, 'refresh-2', 'Strava rotates the refresh token; losing it disconnects them');
  assert.equal(athlete.expires_at, NOW + 21_600);
});

test('concurrent callers for one athlete produce exactly one token exchange', async () => {
  const { athleteStore, tokens, calls } = setup({ athlete: { expiresAt: NOW + 60 } });
  const athlete = athleteStore.get(987654);
  assert.ok(athlete);

  const [a, b, c] = await Promise.all([
    tokens.accessTokenFor(athlete),
    tokens.accessTokenFor(athlete),
    tokens.accessTokenFor(athlete),
  ]);

  assert.equal(calls.refresh, 1, 'later callers must reuse the first refresh, not start their own');
  assert.deepEqual([a, b, c], ['access-2', 'access-2', 'access-2']);
});

test('the second caller never replays the already-rotated refresh token', async () => {
  const { athleteStore, tokens, calls } = setup({ athlete: { refreshToken: 'refresh-1', expiresAt: NOW + 60 } });
  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  await Promise.all([tokens.accessTokenFor(athlete), tokens.accessTokenFor(athlete)]);
  assert.deepEqual(calls.tokens, ['refresh-1']);
});

test('different athletes do not serialize against each other', async () => {
  const db = testDb();
  makeAthlete(db, { athleteId: 1, expiresAt: NOW + 60 });
  makeAthlete(db, { athleteId: 2, expiresAt: NOW + 60 });
  const athleteStore = createAthleteStore(db);

  /** @type {string[]} */
  const order = [];
  /** @type {any} */
  const client = {
    async refresh() {
      order.push('start');
      await new Promise((resolve) => setImmediate(resolve));
      order.push('end');
      return { accessToken: 'a', refreshToken: 'r', expiresAt: NOW + 21_600 };
    },
  };
  const activityStore = createActivityStore(db);
  const logger = collectingLogger();
  const dataDeletionService = createDataDeletionService({
    db, athleteStore, activityStore, strava: { async deauthorize() {} }, logger,
  });
  const tokens = createTokenProvider({ client, athleteStore, dataDeletionService, clock: fixedClock(NOW), logger });

  const a1 = athleteStore.get(1);
  const a2 = athleteStore.get(2);
  assert.ok(a1 && a2);
  await Promise.all([
    tokens.accessTokenFor(a1),
    tokens.accessTokenFor(a2),
  ]);
  assert.deepEqual(order, ['start', 'start', 'end', 'end'], 'per-athlete keys must not block each other');
});

test('a 401 deletes the athlete\'s data and rethrows', async () => {
  const { athleteStore, tokens } = setup({
    athlete: { expiresAt: NOW + 60 },
    refresh: () => { throw new StravaError(401, 'Authorization Error'); },
  });

  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  await assert.rejects(
    () => tokens.accessTokenFor(athlete),
    (error) => error instanceof StravaError && error.status === 401,
  );
  assert.equal(athleteStore.get(987654), undefined, 'a dead token must not leave data behind');
});

test('a non-auth failure rethrows without deleting — a 500 is not a revocation', async () => {
  const { athleteStore, tokens } = setup({
    athlete: { expiresAt: NOW + 60 },
    refresh: () => { throw new StravaError(500, 'Server Error'); },
  });

  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  await assert.rejects(() => tokens.accessTokenFor(athlete), /500/);
  const checked = athleteStore.get(987654);
  assert.ok(checked);
  assert.equal(checked.status, 'active');
});

test('logs the refresh with the athlete id', async () => {
  const { athleteStore, tokens, logger } = setup({ athlete: { expiresAt: NOW + 60 } });
  const athlete = athleteStore.get(987654);
  assert.ok(athlete);
  await tokens.accessTokenFor(athlete);
  /** @param {any} e */
  const hasToken = (e) => e.event === 'token.refreshed' && e.athleteId === 987654;
  assert.ok(logger.entries.some(hasToken));
});
