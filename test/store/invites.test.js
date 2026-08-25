import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, makeAthlete, NOW } from '../support/factories.js';
import { createInviteStore } from '../../src/adapters/store/invites.js';

const DAY = 86_400;

test('getUsable rejects unknown, expired, and consumed invites', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createInviteStore(db);

  store.create({ token: 'good', now: NOW, expiresAt: NOW + 7 * DAY });
  store.create({ token: 'stale', now: NOW - 8 * DAY, expiresAt: NOW - DAY });

  assert.ok(store.getUsable('good', NOW));
  assert.equal(store.getUsable('stale', NOW), undefined);
  assert.equal(store.getUsable('never-minted', NOW), undefined);

  assert.equal(store.consume('good', 987654, NOW), true);
  assert.equal(store.getUsable('good', NOW), undefined);
});

test('consume returns false the second time, so a replayed callback cannot reuse a slot', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createInviteStore(db);
  store.create({ token: 'once', now: NOW, expiresAt: NOW + 7 * DAY });

  assert.equal(store.consume('once', 987654, NOW), true);
  assert.equal(store.consume('once', 987654, NOW), false);
});

test('list exposes state for an owner view', () => {
  const db = testDb();
  makeAthlete(db);
  const store = createInviteStore(db);
  store.create({ token: 'a', now: NOW, expiresAt: NOW + 7 * DAY });
  store.create({ token: 'b', now: NOW, expiresAt: NOW + 7 * DAY });
  store.consume('a', 987654, NOW);

  const rows = store.list();
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.consumed_at !== null).length, 1);
});
