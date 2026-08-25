import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCutoff, chooseSeedActivity, SEED_PAGE_SIZE } from '../../src/domain/seeding.js';

const NOW = 1_800_000_000;
const sportTypes = new Set(['Run', 'TrailRun']);
/** @type {(iso: string) => number} */
const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);

const RIDE_NEWEST = { id: 900, sport_type: 'Ride', start_date: '2026-08-24T10:00:00Z' };
const RUN_OLDER = { id: 800, sport_type: 'Run', start_date: '2026-08-22T06:00:00Z' };
const RUN_OLDEST = { id: 700, sport_type: 'TrailRun', start_date: '2026-08-01T06:00:00Z' };

test('the cutoff is the newest activity of any sport', () => {
  assert.equal(computeCutoff([RUN_OLDER, RIDE_NEWEST, RUN_OLDEST], NOW), ts(RIDE_NEWEST.start_date));
});

test('the cutoff falls back to now when the athlete has no activities', () => {
  assert.equal(computeCutoff([], NOW), NOW);
});

test('the cutoff does not depend on the order the API returned', () => {
  const forwards = computeCutoff([RIDE_NEWEST, RUN_OLDER], NOW);
  const backwards = computeCutoff([RUN_OLDER, RIDE_NEWEST], NOW);
  assert.equal(forwards, backwards);
});

test('the seed is the newest matching run, even when a ride is newer', () => {
  const seed = chooseSeedActivity([RIDE_NEWEST, RUN_OLDER, RUN_OLDEST], sportTypes);
  assert(seed !== null, 'seed should not be null');
  assert.equal(seed.id, 800);
});

test('the seed matches any configured sport type, not just Run', () => {
  const seed = chooseSeedActivity([RUN_OLDEST], sportTypes);
  assert(seed !== null, 'seed should not be null');
  assert.equal(seed.id, 700);
});

test('no matching activity yields null rather than throwing', () => {
  assert.equal(chooseSeedActivity([RIDE_NEWEST], sportTypes), null);
  assert.equal(chooseSeedActivity([], sportTypes), null);
});

test('the page size is ten, as the spec specifies', () => {
  assert.equal(SEED_PAGE_SIZE, 10);
});
