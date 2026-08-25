import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedLock } from '../../src/adapters/lock.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('serializes work sharing a key', async () => {
  const withLock = createKeyedLock();
  const events = /** @type {string[]} */ ([]);
  const job = (/** @type {string} */ name) => async () => {
    events.push(`${name}:start`);
    await tick();
    await tick();
    events.push(`${name}:end`);
  };
  await Promise.all([withLock('a', job('one')), withLock('a', job('two'))]);
  assert.deepEqual(events, ['one:start', 'one:end', 'two:start', 'two:end']);
});

test('runs different keys concurrently', async () => {
  const withLock = createKeyedLock();
  const events = /** @type {string[]} */ ([]);
  const job = (/** @type {string} */ name) => async () => {
    events.push(`${name}:start`);
    await tick();
    events.push(`${name}:end`);
  };
  await Promise.all([withLock('a', job('one')), withLock('b', job('two'))]);
  assert.deepEqual(events, ['one:start', 'two:start', 'one:end', 'two:end']);
});

test('returns the function result to the caller', async () => {
  assert.equal(await createKeyedLock()('a', async () => 42), 42);
});

test('propagates a rejection to that caller only, and the queue keeps moving', async () => {
  const withLock = createKeyedLock();
  const failing = withLock('a', async () => { throw new Error('boom'); });
  const following = withLock('a', async () => 'still ran');

  await assert.rejects(failing, /boom/);
  assert.equal(await following, 'still ran');
});

test('releases the key once the queue drains, so the map cannot grow forever', async () => {
  const withLock = createKeyedLock();
  await withLock('a', async () => {});
  await tick();
  assert.equal(withLock.size(), 0);
});

test('a rejection inside the lock never surfaces as an unhandled rejection', async () => {
  const seen = /** @type {Error[]} */ ([]);
  const onUnhandled = (/** @type {Error} */ reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const withLock = createKeyedLock();
    await withLock('a', async () => { throw new Error('boom'); }).catch(() => {});
    await tick();
    await tick();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, []);
});

test('a synchronous throw inside fn is still serialized, not escaped', async () => {
  const withLock = createKeyedLock();
  const failing = withLock('a', () => { throw new Error('sync boom'); });
  const following = withLock('a', async () => 'ran after');

  await assert.rejects(failing, /sync boom/);
  assert.equal(await following, 'ran after');
});
