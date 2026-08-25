import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETENTION_SECONDS, expiryFor } from '../../src/domain/retention.js';

test('expiryFor adds the retention window to now', () => {
  assert.equal(expiryFor(1000), 1000 + RETENTION_SECONDS);
});

test('RETENTION_SECONDS is seven days', () => {
  assert.equal(RETENTION_SECONDS, 7 * 24 * 3600);
});
