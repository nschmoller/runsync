/** @typedef {import('../ports/index.js').Clock} Clock */

/**
 * Unix seconds. Injected everywhere rather than called inline, so tests can
 * assert exact timestamps without freezing global time.
 * @returns {Clock}
 */
export function systemClock() {
  return { now: () => Math.floor(Date.now() / 1000) };
}
