import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityJob, jobKey } from '../../src/services/jobs.js';

test('activityJob builds a typed job', () => {
  assert.deepEqual(activityJob(987654, 555), { type: 'activity.process', athleteId: 987654, activityId: 555 });
});

test('jobKey serializes two events for one activity onto the same key', () => {
  assert.equal(jobKey(activityJob(1, 555)), jobKey(activityJob(1, 555)));
});

test('jobKey keys on the activity, not the athlete — the same activity has one owner', () => {
  assert.equal(jobKey(activityJob(1, 555)), 'activity:555');
});

test('different activities get different keys, so they never block each other', () => {
  assert.notEqual(jobKey(activityJob(1, 555)), jobKey(activityJob(1, 556)));
});

test('an unknown job type throws rather than silently colliding on one key', () => {
  assert.throws(() => jobKey(/** @type {any} */ ({ type: 'nope' })), /nope/);
});
