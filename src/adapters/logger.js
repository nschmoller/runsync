/** @typedef {import('../ports/index.js').Logger} Logger */

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON-lines logging. Events are dotted names (`activity.appended`),
 * not sentences, so they can be grepped and counted.
 *
 * @param {{ level?: 'debug'|'info'|'warn'|'error', stream?: { write: (line: string) => void } }} [options]
 * @returns {Logger}
 */
export function createLogger({ level = 'info', stream = process.stdout } = {}) {
  const threshold = ORDER[level];

  /** @param {Record<string, unknown>} context @returns {Logger} */
  function build(context) {
    /** @param {'debug'|'info'|'warn'|'error'} entryLevel */
    const emit = (entryLevel) => (/** @type {string} */ event, fields = {}) => {
      if (ORDER[entryLevel] < threshold) return;
      const entry = { time: new Date().toISOString(), level: entryLevel, event, ...context, ...fields };
      let line;
      try {
        line = JSON.stringify(entry);
      } catch {
        // A caller passing something unserializable must not take down the
        // request that was trying to log it.
        line = JSON.stringify({ time: entry.time, level: entryLevel, event, logError: 'unserializable fields' });
      }
      stream.write(`${line}\n`);
    };

    return {
      debug: emit('debug'),
      info: emit('info'),
      warn: emit('warn'),
      error: emit('error'),
      child: (fields) => build({ ...context, ...fields }),
    };
  }

  return build({});
}
