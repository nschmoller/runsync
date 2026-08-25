import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, NOW } from '../support/factories.js';
import { createActivityStore } from '../../src/adapters/store/activities.js';

test('records, reports, and clears a processed activity', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createActivityStore(db);

  assert.equal(store.isProcessed(555), false);
  store.markProcessed(555, 987654, NOW);
  assert.equal(store.isProcessed(555), true);
  store.deleteProcessed(555);
  assert.equal(store.isProcessed(555), false);
});

test('markProcessed is idempotent on a repeated activity id', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createActivityStore(db);
  store.markProcessed(555, 987654, NOW);
  assert.doesNotThrow(() => store.markProcessed(555, 987654, NOW + 5));
  assert.equal(store.count(), 1);
});

test('recentFor returns one athlete newest-first, limited, and never another athlete', () => {
  const db = testDb();
  makeAthlete(db, { athleteId: 1 });
  makeAthlete(db, { athleteId: 2 });
  const store = createActivityStore(db);

  store.markProcessed(10, 1, NOW - 30);
  store.markProcessed(11, 1, NOW - 10);
  store.markProcessed(12, 1, NOW - 20);
  store.markProcessed(99, 2, NOW);

  const recent = store.recentFor(1, 2);
  assert.deepEqual(recent.map((r) => r.activity_id), [11, 12]);
});
