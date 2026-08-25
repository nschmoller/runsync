import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb, NOW } from '../support/factories.js';
import { createAuthStateStore } from '../../src/adapters/store/authStates.js';

test('consume returns the row once, then never again', () => {
  const store = createAuthStateStore(testDb());
  store.create({ state: 's1', inviteToken: 'tok', pendingMessage: 'hi', now: NOW, expiresAt: NOW + 600 });

  const row = /** @type {any} */ (store.consume('s1', NOW));
  assert.equal(row.invite_token, 'tok');
  assert.equal(row.pending_message, 'hi');
  assert.equal(store.consume('s1', NOW), undefined, 'state is single-use');
});

test('consume rejects unknown and expired states', () => {
  const store = createAuthStateStore(testDb());
  store.create({ state: 'old', inviteToken: null, pendingMessage: null, now: NOW - 3600, expiresAt: NOW - 60 });

  assert.equal(store.consume('old', NOW), undefined);
  assert.equal(store.consume('nonexistent', NOW), undefined);
});

test('sweep deletes expired rows so the table cannot grow without bound', () => {
  const db = testDb();
  const store = createAuthStateStore(db);
  store.create({ state: 'old', inviteToken: null, pendingMessage: null, now: NOW - 3600, expiresAt: NOW - 60 });
  store.create({ state: 'fresh', inviteToken: null, pendingMessage: null, now: NOW, expiresAt: NOW + 600 });

  store.sweep(NOW);
  const result = /** @type {any} */ (db.prepare('SELECT COUNT(*) AS n FROM oauth_states').get());
  assert.equal(result.n, 1);
  assert.ok(store.consume('fresh', NOW));
});
