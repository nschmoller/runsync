import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectingLogger } from '../support/factories.js';
import { createInlineDispatcher } from '../../src/adapters/dispatch/inline.js';
import { activityJob } from '../../src/services/jobs.js';

/** @typedef {import('../../src/ports/index.js').ActivityJob} ActivityJob */

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @param {(job: ActivityJob) => Promise<unknown>} [handler]
 */
function setup(handler) {
  const logger = collectingLogger();
  /** @type {ActivityJob[]} */
  const seen = [];
  const dispatcher = createInlineDispatcher({
    handlers: {
      'activity.process': async (job) => {
        seen.push(job);
        if (handler) return handler(job);
        return 'appended';
      },
    },
    logger,
  });
  return { dispatcher, seen, logger };
}

test('dispatch runs the handler for the job type', async () => {
  const { dispatcher, seen } = setup();
  dispatcher.dispatch(activityJob(987654, 555));
  await dispatcher.drain();
  assert.deepEqual(seen, [{ type: 'activity.process', athleteId: 987654, activityId: 555 }]);
});

test('dispatch returns synchronously and undefined — the caller cannot await it', () => {
  const { dispatcher } = setup();
  assert.equal(dispatcher.dispatch(activityJob(1, 555)), undefined);
});

test('two jobs for one activity are serialized', async () => {
  /** @type {string[]} */
  const order = [];
  const { dispatcher } = setup(async (job) => {
    order.push(`start:${job.athleteId}`);
    await tick();
    await tick();
    order.push(`end:${job.athleteId}`);
  });

  dispatcher.dispatch(activityJob(1, 555));
  dispatcher.dispatch(activityJob(2, 555));
  await dispatcher.drain();

  assert.deepEqual(order, ['start:1', 'end:1', 'start:2', 'end:2']);
});

test('jobs for different activities run concurrently', async () => {
  /** @type {string[]} */
  const order = [];
  const { dispatcher } = setup(async (job) => {
    order.push(`start:${job.activityId}`);
    await tick();
    order.push(`end:${job.activityId}`);
  });

  dispatcher.dispatch(activityJob(1, 555));
  dispatcher.dispatch(activityJob(1, 556));
  await dispatcher.drain();

  assert.deepEqual(order, ['start:555', 'start:556', 'end:555', 'end:556']);
});

test('a throwing handler is logged and does not stop later jobs', async () => {
  let attempt = 0;
  const { dispatcher, logger } = setup(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('boom');
    return 'appended';
  });

  dispatcher.dispatch(activityJob(1, 555));
  dispatcher.dispatch(activityJob(1, 556));
  await dispatcher.drain();

  assert.equal(attempt, 2);
  assert.ok(logger.entries.some((/** @type {any} */ e) => e.level === 'error' && e.event === 'job.failed'));
});

test('a failing job never becomes an unhandled rejection', async () => {
  /** @type {any[]} */
  const seen = [];
  const onUnhandled = (/** @type {any} */ reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { dispatcher } = setup(async () => { throw new Error('boom'); });
    dispatcher.dispatch(activityJob(1, 555));
    await dispatcher.drain();
    await tick();
    await tick();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, [], 'an unhandled rejection would kill the container');
});

test('a non-Error rejection reason never becomes an unhandled rejection', async () => {
  /** @type {any[]} */
  const seen = [];
  const onUnhandled = (/** @type {any} */ reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  let logger;
  try {
    const setup_result = setup(async () => { return Promise.reject('string boom'); });
    logger = setup_result.logger;
    const dispatcher = setup_result.dispatcher;
    dispatcher.dispatch(activityJob(1, 555));
    await dispatcher.drain();
    await tick();
    await tick();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, [], 'an unhandled rejection would kill the container');
  assert.ok(logger.entries.some((/** @type {any} */ e) => e.level === 'error' && e.event === 'job.failed'));
});

test('an unknown job type is logged and dropped rather than thrown at the caller', async () => {
  const { dispatcher, logger } = setup();
  assert.doesNotThrow(() => dispatcher.dispatch(/** @type {any} */ ({ type: 'unknown.thing' })));
  await dispatcher.drain();
  assert.ok(logger.entries.some((/** @type {any} */ e) => e.event === 'job.unknown-type'));
});

test('drain resolves immediately when nothing is in flight', async () => {
  const { dispatcher } = setup();
  await assert.doesNotReject(() => dispatcher.drain());
});

test('drain waits for work queued by earlier work', async () => {
  const { dispatcher, seen } = setup(async (/** @type {ActivityJob} */ job) => {
    if (job.activityId === 555) dispatcher.dispatch(activityJob(1, 556));
  });

  dispatcher.dispatch(activityJob(1, 555));
  await dispatcher.drain();

  assert.equal(seen.length, 2);
});
