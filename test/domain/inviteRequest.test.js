import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInviteRequest, MAX_NAME_LENGTH } from '../../src/domain/inviteRequest.js';

test('accepts a trimmed name and email', () => {
  const result = validateInviteRequest({ name: '  Ada Lovelace  ', email: '  ada@example.com  ' });
  assert.deepEqual(result, { ok: true, value: { name: 'Ada Lovelace', email: 'ada@example.com' } });
});

test('rejects a blank name', () => {
  const result = validateInviteRequest({ name: '  ', email: 'ada@example.com' });
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, /name/i);
});

test('rejects a missing name', () => {
  const result = validateInviteRequest({ name: undefined, email: 'ada@example.com' });
  assert.equal(result.ok, false);
});

test('rejects a name over the maximum length', () => {
  const result = validateInviteRequest({ name: 'a'.repeat(MAX_NAME_LENGTH + 1), email: 'ada@example.com' });
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, new RegExp(String(MAX_NAME_LENGTH)));
});

test('rejects a blank email', () => {
  const result = validateInviteRequest({ name: 'Ada', email: '' });
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, /email/i);
});

test('rejects an email missing an @ or a domain', () => {
  const result = validateInviteRequest({ name: 'Ada', email: 'not-an-email' });
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, /email/i);
});

test('strips control characters from name and email', () => {
  const result = validateInviteRequest({ name: 'Ada\x00Lovelace', email: 'ada@example.com' });
  assert.equal(result.ok, true);
  assert.equal(/** @type {any} */ (result).value.name, 'AdaLovelace');
});
