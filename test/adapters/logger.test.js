import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/adapters/logger.js';

function capture(level = 'info') {
  const lines = /** @type {string[]} */ ([]);
  const stream = { write: (/** @type {string} */ line) => lines.push(line) };
  return { logger: createLogger({ level: /** @type {'debug'|'info'|'warn'|'error'} */ (level), stream }), lines, parsed: () => lines.map((l) => JSON.parse(l)) };
}

test('writes one JSON object per line with level, event, and time', () => {
  const { logger, lines, parsed } = capture();
  logger.info('activity.appended', { athleteId: 1, activityId: 555 });

  assert.equal(lines.length, 1);
  assert.ok(lines[0]?.endsWith('\n'));
  const entry = parsed()[0];
  assert.equal(entry.level, 'info');
  assert.equal(entry.event, 'activity.appended');
  assert.equal(entry.athleteId, 1);
  assert.equal(typeof entry.time, 'string');
});

test('suppresses entries below the configured level', () => {
  const { logger, lines } = capture('warn');
  logger.debug('noise');
  logger.info('also noise');
  logger.warn('kept');
  logger.error('kept too');
  assert.equal(lines.length, 2);
});

test('child loggers merge their context into every entry', () => {
  const { logger, parsed } = capture();
  const scoped = logger.child({ athleteId: 42 });
  scoped.info('token.refreshed');
  assert.equal(parsed()[0].athleteId, 42);
});

test('child context nests and the innermost wins', () => {
  const { logger, parsed } = capture();
  logger.child({ athleteId: 1, source: 'webhook' }).child({ athleteId: 2 }).info('e');
  assert.equal(parsed()[0].athleteId, 2);
  assert.equal(parsed()[0].source, 'webhook');
});

test('call-site fields override child context', () => {
  const { logger, parsed } = capture();
  logger.child({ athleteId: 1 }).info('e', { athleteId: 9 });
  assert.equal(parsed()[0].athleteId, 9);
});

test('survives a value that cannot be serialized rather than throwing mid-request', () => {
  const { logger, lines } = capture();
  const circular = /** @type {any} */ ({});
  circular.self = circular;
  assert.doesNotThrow(() => logger.info('e', { circular }));
  assert.equal(lines.length, 1);
});
