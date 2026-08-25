import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const valid = {
  STRAVA_CLIENT_ID: '12345',
  STRAVA_CLIENT_SECRET: 'secret',
  STRAVA_WEBHOOK_VERIFY_TOKEN: 'verify',
  APPEND_MESSAGE: '🏃 Synced via runsync',
  SESSION_SECRET: 'a'.repeat(32),
  BASE_URL: 'https://runsync.example.com',
};

test('loads a valid environment', () => {
  const config = loadConfig(valid);
  assert.equal(config.clientId, '12345');
  assert.equal(config.appendMessage, '🏃 Synced via runsync');
  assert.equal(config.baseUrl, 'https://runsync.example.com');
  assert.equal(config.logLevel, 'info');
});

test('defaults SPORT_TYPES to Run and TrailRun', () => {
  const config = loadConfig(valid);
  assert.deepEqual([...config.sportTypes].sort(), ['Run', 'TrailRun'].sort());
  assert.ok(!config.sportTypes.has('Ride'));
});

test('parses an explicit SPORT_TYPES list, trimming whitespace', () => {
  const config = loadConfig({ ...valid, SPORT_TYPES: 'Run, VirtualRun ' });
  assert.deepEqual([...config.sportTypes].sort(), ['Run', 'VirtualRun']);
});

test('throws naming every missing required variable', () => {
  const { STRAVA_CLIENT_SECRET, SESSION_SECRET, ...rest } = valid;
  assert.throws(() => loadConfig(rest), (/** @type {unknown} */ err) => {
    if (!(err instanceof Error)) return false;
    return /STRAVA_CLIENT_SECRET/.test(err.message) && /SESSION_SECRET/.test(err.message);
  });
});

test('rejects a short SESSION_SECRET', () => {
  assert.throws(() => loadConfig({ ...valid, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
});

test('strips a trailing slash from BASE_URL', () => {
  assert.equal(loadConfig({ ...valid, BASE_URL: 'https://x.example.com/' }).baseUrl, 'https://x.example.com');
});

test('subscriptionId is null when unset and a number when set', () => {
  assert.equal(loadConfig(valid).subscriptionId, null);
  assert.equal(loadConfig({ ...valid, STRAVA_SUBSCRIPTION_ID: '77' }).subscriptionId, 77);
});

test('adminAthleteIds is empty by default and parses a numeric list', () => {
  assert.equal(loadConfig(valid).adminAthleteIds.size, 0);
  const config = loadConfig({ ...valid, ADMIN_ATHLETE_IDS: '111, 222' });
  assert.ok(config.adminAthleteIds.has(111));
  assert.ok(config.adminAthleteIds.has(222));
});

test('rejects a non-numeric ADMIN_ATHLETE_IDS entry rather than silently ignoring it', () => {
  assert.throws(() => loadConfig({ ...valid, ADMIN_ATHLETE_IDS: '111,bob' }), /ADMIN_ATHLETE_IDS/);
});

test('rejects an unknown LOG_LEVEL', () => {
  assert.throws(() => loadConfig({ ...valid, LOG_LEVEL: 'chatty' }), /LOG_LEVEL/);
});
