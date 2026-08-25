/**
 * How long a processed-activity record is kept. Bounding retention to what the
 * idempotency guarantee actually needs — Strava can redeliver a webhook or an
 * athlete can re-edit an activity for a while, but not forever.
 */
export const RETENTION_SECONDS = 7 * 24 * 3600;

/** @param {number} now @returns {number} */
export function expiryFor(now) {
  return now + RETENTION_SECONDS;
}
