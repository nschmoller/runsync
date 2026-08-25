import { createKeyedLock } from '../lock.js';

/** @typedef {import('../../ports/index.js').Dispatcher} Dispatcher */
/** @typedef {import('../../ports/index.js').Job} Job */
/** @typedef {import('../../ports/index.js').Logger} Logger */

/**
 * Runs jobs in-process, immediately, serialized by job key.
 *
 * This is the seam for a durable queue. Everything upstream builds a typed job
 * and calls `dispatch`; nothing upstream knows the work happens inline. A
 * queue-backed adapter implements the same two methods and swaps in at the
 * composition root.
 *
 * @param {{ handlers: Record<string, (job: Job) => Promise<unknown>>, logger: Logger }} deps
 * @returns {Dispatcher}
 */
export function createInlineDispatcher({ handlers, logger }) {
  const withJobLock = createKeyedLock();
  /** @type {Set<Promise<void>>} */
  const pending = new Set();

  /** @param {Job} job */
  function dispatch(job) {
    const handler = handlers[job.type];
    if (!handler) {
      logger.error('job.unknown-type', { type: /** @type {any} */ (job).type });
      return;
    }

    // Every detached chain ends here in a .catch(). An unhandled rejection on
    // this path would take the container down.
    // `Job` currently has one variant, whose globally unique activity id is
    // the serialization boundary. Keep this derivation here: importing the
    // service helper would violate the adapters -> services dependency rule.
    const tracked = withJobLock(`activity:${job.activityId}`, () => handler(job))
      .then(
        (outcome) => logger.debug('job.done', { type: job.type, outcome }),
        (error) => logger.error('job.failed', { type: job.type, error: error.message }),
      );

    pending.add(tracked);
    tracked.finally(() => pending.delete(tracked));
  }

  return {
    dispatch,
    // Loops rather than awaiting once: a handler may dispatch further work.
    async drain() {
      while (pending.size > 0) await Promise.all([...pending]);
    },
  };
}
