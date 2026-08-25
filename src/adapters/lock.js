/**
 * Serializes async work per key.
 *
 * The map read and the map write below MUST stay synchronous — they happen in
 * one tick, before any `await`. Introducing an `await` between the `get` and
 * the `set` reopens exactly the interleaving this lock exists to close.
 *
 * @returns {(<T>(key: string|number, fn: () => Promise<T>|T) => Promise<T>) & { size: () => number }}
 */
export function createKeyedLock() {
  /** @type {Map<string|number, Promise<void>>} */
  const inFlight = new Map();

  const withLock = (/** @type {string|number} */ key, /** @type {() => Promise<any>|any} */ fn) => {
    const previous = inFlight.get(key) ?? Promise.resolve();
    // Wrapping fn() in the .then callback means a synchronous throw becomes a
    // rejection of `result` rather than escaping past the bookkeeping below.
    const result = previous.then(() => fn());

    // `settled` never rejects, so holding it in the map can never produce an
    // unhandled rejection for a caller that has already handled its own.
    const settled = result.then(() => {}, () => {});
    const guarded = settled.finally(() => {
      if (inFlight.get(key) === guarded) inFlight.delete(key);
    });
    inFlight.set(key, guarded);

    return result;
  };

  withLock.size = () => inFlight.size;
  return withLock;
}
