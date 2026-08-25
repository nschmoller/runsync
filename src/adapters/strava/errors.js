export class StravaError extends Error {
  /** @param {number} status @param {string} detail */
  constructor(status, detail) {
    super(`Strava API ${status}: ${detail}`);
    this.name = 'StravaError';
    this.status = status;
  }
}

/**
 * A revoked authorization. The deauthorization webhook is not guaranteed to
 * arrive, so this is the backstop that stops a dead row failing forever.
 * @param {unknown} error
 */
export function isAuthError(error) {
  return error instanceof StravaError && error.status === 401;
}

/** @param {unknown} error */
export function isRateLimited(error) {
  return error instanceof StravaError && error.status === 429;
}
