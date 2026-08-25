import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePreFetch, decidePostFetch, startedAt } from '../../src/domain/rules.js';

/** @type {any} */
const config = { appendMessage: '🏃 Synced via racegoal', sportTypes: new Set(['Run', 'TrailRun']) };
const goal = (/** @type {string} */ message) => `- - - 🎯 Goal - - -\n${message}`;
const CUTOFF = 1_700_000_000;

/** @type {(overrides?: any) => any} */
const athlete = (overrides = {}) => ({
  athlete_id: 987654, status: 'active', message: null, activity_cutoff: CUTOFF, ...overrides,
});

/** @type {(overrides?: any) => any} */
const activity = (overrides = {}) => ({
  id: 555, sport_type: 'Run', start_date: '2024-01-01T00:00:00Z', description: 'Great run!', ...overrides,
});

test('an unknown athlete is skipped before any fetch', () => {
  assert.deepEqual(decidePreFetch({ athlete: undefined, alreadyProcessed: false }),
    { action: 'skip', reason: 'unknown-athlete' });
});

test('a revoked athlete is skipped before any fetch', () => {
  assert.deepEqual(decidePreFetch({ athlete: athlete({ status: 'revoked' }), alreadyProcessed: false }),
    { action: 'skip', reason: 'revoked' });
});

test('an already-processed activity is skipped before any fetch, protecting the rate limit', () => {
  assert.deepEqual(decidePreFetch({ athlete: athlete(), alreadyProcessed: true }),
    { action: 'skip', reason: 'already-processed' });
});

test('an active athlete with an unprocessed activity proceeds to fetch', () => {
  assert.deepEqual(decidePreFetch({ athlete: athlete(), alreadyProcessed: false }), { action: 'fetch' });
});

test('the revoked check wins over the processed check, so a dead athlete never looks busy', () => {
  assert.deepEqual(decidePreFetch({ athlete: athlete({ status: 'revoked' }), alreadyProcessed: true }),
    { action: 'skip', reason: 'revoked' });
});

test('appends to a run after the cutoff', () => {
  const decision = decidePostFetch({ athlete: athlete(), activity: activity(), config });
  assert.deepEqual(decision, { action: 'append', description: `Great run!\n\n${goal('🏃 Synced via racegoal')}` });
});

test('uses the athlete own message when they have one', () => {
  const decision = decidePostFetch({
    athlete: athlete({ message: 'Powered by stubbornness' }), activity: activity(), config,
  });
  // @ts-ignore - decision is guaranteed to have action: 'append' in this context
  assert.equal(decision.description, `Great run!\n\n${goal('Powered by stubbornness')}`);
});

test('skips an activity before the cutoff, including on a later edit', () => {
  const decision = decidePostFetch({
    athlete: athlete(), activity: activity({ start_date: '2020-01-01T00:00:00Z' }), config,
  });
  assert.deepEqual(decision, { action: 'skip', reason: 'before-cutoff' });
});

test('an activity exactly at the cutoff is skipped', () => {
  const decision = decidePostFetch({
    athlete: athlete(), activity: activity({ start_date: new Date(CUTOFF * 1000).toISOString() }), config,
  });
  assert.deepEqual(decision, { action: 'skip', reason: 'before-cutoff' });
});

test('the cutoff is checked before the sport type, so an old ride reports the more specific reason', () => {
  const decision = decidePostFetch({
    athlete: athlete(),
    activity: activity({ sport_type: 'Ride', start_date: '2020-01-01T00:00:00Z' }),
    config,
  });
  // @ts-ignore - decision is guaranteed to have action: 'skip' with a reason in this context
  assert.equal(decision.reason, 'before-cutoff');
});

test('skips a sport outside SPORT_TYPES', () => {
  const decision = decidePostFetch({ athlete: athlete(), activity: activity({ sport_type: 'Ride' }), config });
  assert.deepEqual(decision, { action: 'skip', reason: 'wrong-sport' });
});

test('accepts TrailRun, which is in the default allowlist', () => {
  assert.equal(decidePostFetch({ athlete: athlete(), activity: activity({ sport_type: 'TrailRun' }), config }).action,
    'append');
});

test('records without a PUT when the description already contains the message', () => {
  const decision = decidePostFetch({
    athlete: athlete(),
    activity: activity({ description: `Great run!\n\n${goal('🏃 Synced via racegoal')}` }),
    config,
  });
  assert.deepEqual(decision, { action: 'record', reason: 'backfill' });
});

test('does not append twice when the athlete typed text after the message', () => {
  const decision = decidePostFetch({
    athlete: athlete(),
    activity: activity({ description: `${goal('🏃 Synced via racegoal')}\n\nsplit negative!` }),
    config,
  });
  assert.equal(decision.action, 'record');
});

test('appends onto an empty description without a leading blank line', () => {
  const decision = decidePostFetch({ athlete: athlete(), activity: activity({ description: null }), config });
  // @ts-ignore - decision is guaranteed to have action: 'append' in this context
  assert.equal(decision.description, goal('🏃 Synced via racegoal'));
});

test('startedAt converts an ISO date to unix seconds', () => {
  assert.equal(startedAt({ start_date: '2024-01-01T00:00:00Z' }), 1_704_067_200);
});
