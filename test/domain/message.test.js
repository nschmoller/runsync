import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMessage, resolveMessage, hasMessage, appendMessage, MAX_MESSAGE_LENGTH,
} from '../../src/domain/message.js';

const config = { appendMessage: '🏃 Synced via runsync' };

test('trims surrounding whitespace', () => {
  assert.deepEqual(validateMessage('  hello  '), { ok: true, value: 'hello' });
});

test('blank, whitespace-only, undefined, and null all mean "use the default"', () => {
  for (const input of ['', '   \n  ', undefined, null]) {
    assert.deepEqual(validateMessage(input), { ok: true, value: null });
  }
});

test('accepts exactly the cap and rejects one character more', () => {
  assert.equal(validateMessage('x'.repeat(MAX_MESSAGE_LENGTH)).ok, true);
  const tooLong = validateMessage('x'.repeat(MAX_MESSAGE_LENGTH + 1));
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.error, /200/);
});

test('measures length after cleaning, so trailing whitespace cannot fail a valid message', () => {
  assert.equal(validateMessage(`${'x'.repeat(MAX_MESSAGE_LENGTH)}    `).ok, true);
});

test('keeps emoji and accents intact', () => {
  assert.deepEqual(validateMessage('🏃 café'), { ok: true, value: '🏃 café' });
});

test('strips control characters but keeps newlines', () => {
  const msg = 'a' + String.fromCharCode(1) + 'b\nc';
  assert.deepEqual(validateMessage(msg), { ok: true, value: 'ab\nc' });
});

test('normalizes CRLF and collapses runs of blank lines', () => {
  assert.deepEqual(validateMessage('a\r\nb\n\n\n\nc'), { ok: true, value: 'a\nb\n\nc' });
});

test('resolveMessage falls back to the configured default only when the athlete has none', () => {
  assert.equal(resolveMessage({ message: null }, config), '🏃 Synced via runsync');
  assert.equal(resolveMessage({ message: 'mine' }, config), 'mine');
});

test('hasMessage matches anywhere, not only at the end', () => {
  const msg = '🏃 Synced via runsync';
  assert.equal(hasMessage(`Great run!\n\n${msg}`, msg), true);
  assert.equal(hasMessage(`${msg}\n\nadded this later`, msg), true, 'includes, not endsWith');
  assert.equal(hasMessage('Great run!', msg), false);
  assert.equal(hasMessage(null, msg), false);
  assert.equal(hasMessage('', msg), false);
});

test('appendMessage preserves the athlete text and separates with a blank line', () => {
  assert.equal(appendMessage('Great run!', 'MSG'), 'Great run!\n\nMSG');
});

test('appendMessage handles an empty, null, or whitespace description', () => {
  assert.equal(appendMessage(null, 'MSG'), 'MSG');
  assert.equal(appendMessage('', 'MSG'), 'MSG');
  assert.equal(appendMessage('   ', 'MSG'), 'MSG');
});

test('appendMessage does not stack blank lines on a description that ends in one', () => {
  assert.equal(appendMessage('Great run!\n\n', 'MSG'), 'Great run!\n\nMSG');
});
