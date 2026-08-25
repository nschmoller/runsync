/** A caller-supplied value the domain refuses. Maps to HTTP 400. */
export class ValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** A request that conflicts with stored state — a consumed invite, a replayed state. Maps to HTTP 409/403. */
export class ConflictError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}
