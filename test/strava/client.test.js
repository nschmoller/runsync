import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig, NOW } from '../support/factories.js';
import { mockStrava } from '../support/http.js';
import { createStravaClient } from '../../src/adapters/strava/client.js';
import { StravaError, isAuthError, isRateLimited } from '../../src/adapters/strava/errors.js';

test('exchangeCode returns tokens and athlete identity', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
    access_token: 'access-new',
    refresh_token: 'refresh-new',
    expires_at: NOW + 21_600,
    athlete: { id: 987654, firstname: 'Test', lastname: 'Athlete' },
  });

  const result = await createStravaClient({ config: testConfig() }).exchangeCode('the-code');
  assert.equal(result.athleteId, 987654);
  assert.equal(result.name, 'Test Athlete');
  assert.equal(result.accessToken, 'access-new');
  assert.equal(result.refreshToken, 'refresh-new');
  assert.equal(result.expiresAt, NOW + 21_600);
  await mock.close();
});

test('exchangeCode copes with an athlete missing a last name', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/oauth/token', method: 'POST' }).reply(200, {
    access_token: 'a', refresh_token: 'r', expires_at: NOW,
    athlete: { id: 1, firstname: 'Mononym', lastname: null },
  });
  assert.equal((await createStravaClient({ config: testConfig() }).exchangeCode('c')).name, 'Mononym');
  await mock.close();
});

test('refresh returns the rotated token pair', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/oauth/token', method: 'POST' })
    .reply(200, { access_token: 'a2', refresh_token: 'r2', expires_at: NOW + 21_600 });

  const result = await createStravaClient({ config: testConfig() }).refresh('r1');
  assert.deepEqual(result, { accessToken: 'a2', refreshToken: 'r2', expiresAt: NOW + 21_600 });
  await mock.close();
});

test('getActivity returns the fields the rules need', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/api/v3/activities/555', method: 'GET' })
    .reply(200, { id: 555, sport_type: 'Run', start_date: '2026-08-25T07:00:00Z', description: 'Great run!' });

  const activity = await createStravaClient({ config: testConfig() }).getActivity('token', 555);
  assert.equal(activity.sport_type, 'Run');
  assert.equal(activity.start_date, '2026-08-25T07:00:00Z');
  assert.equal(activity.description, 'Great run!');
  await mock.close();
});

test('getActivity sends the bearer token', async () => {
  const mock = mockStrava();
  let auth = '';
  mock.pool.intercept({ path: '/api/v3/activities/555', method: 'GET' }).reply((opts) => {
    if (opts.headers && typeof opts.headers === 'object' && !('get' in opts.headers)) {
      auth = (opts.headers.Authorization ?? opts.headers.authorization) || '';
    }
    return { statusCode: 200, data: { id: 555, sport_type: 'Run', start_date: '2026-08-25T07:00:00Z' } };
  });

  await createStravaClient({ config: testConfig() }).getActivity('the-token', 555);
  assert.equal(auth, 'Bearer the-token');
  await mock.close();
});

test('updateActivity sends the description as a form body, preserving newlines', async () => {
  const mock = mockStrava();
  let bodyText = '';
  mock.pool.intercept({ path: '/api/v3/activities/555', method: 'PUT' }).reply((opts) => {
    if (opts.body) {
      bodyText = typeof opts.body === 'string' ? opts.body : String(opts.body);
    }
    return { statusCode: 200, data: {} };
  });

  await createStravaClient({ config: testConfig() })
    .updateActivity('token', 555, { description: 'Great run!\n\nMSG' });

  assert.ok(new URLSearchParams(bodyText).get('description')?.includes('Great run!\n\nMSG'));
  await mock.close();
});

test('listRecentActivities requests the given page size', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/api/v3/athlete/activities?per_page=10', method: 'GET' })
    .reply(200, [{ id: 2, sport_type: 'Ride', start_date: '2026-08-24T07:00:00Z' }]);

  const activities = await createStravaClient({ config: testConfig() }).listRecentActivities('token', 10);
  assert.equal(activities.length, 1);
  await mock.close();
});

test('a non-2xx response throws StravaError carrying the status', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/api/v3/activities/555', method: 'GET' })
    .reply(429, { message: 'Rate Limit Exceeded' });

  await assert.rejects(
    () => createStravaClient({ config: testConfig() }).getActivity('token', 555),
    (error) => error instanceof StravaError && error.status === 429 && isRateLimited(error),
  );
  await mock.close();
});

test('isAuthError recognizes 401 and nothing else', () => {
  assert.equal(isAuthError(new StravaError(401, 'nope')), true);
  assert.equal(isAuthError(new StravaError(403, 'nope')), false);
  assert.equal(isAuthError(new Error('unrelated')), false);
});

test('an empty 2xx body does not blow up JSON parsing', async () => {
  const mock = mockStrava();
  mock.pool.intercept({ path: '/oauth/deauthorize', method: 'POST' }).reply(200, '');
  await assert.doesNotReject(() => createStravaClient({ config: testConfig() }).deauthorize('token'));
  await mock.close();
});
