import { startedAt } from './rules.js';

/** @typedef {import('../ports/index.js').Activity} Activity */

export const SEED_PAGE_SIZE = 10;

/** @param {Activity[]} activities @returns {Activity[]} newest first */
function newestFirst(activities) {
  return [...activities].sort((a, b) => startedAt(b) - startedAt(a));
}

/**
 * The cutoff is the newest activity of ANY sport — not the newest run. An
 * athlete whose latest upload was a ride should still have that ride, and
 * everything before it, treated as history.
 *
 * @param {Activity[]} activities
 * @param {number} fallbackNow used when the athlete has no activities at all
 * @returns {number} unix seconds
 */
export function computeCutoff(activities, fallbackNow) {
  const sorted = newestFirst(activities);
  if (sorted.length === 0) return fallbackNow;
  const newest = sorted[0];
  if (!newest) return fallbackNow;
  return startedAt(newest);
}

/**
 * The one historical activity the service is allowed to touch: the athlete's
 * most recent matching run, which gives them immediate visible confirmation
 * that the connection works. It may be older than the cutoff — that is fine,
 * because it gets a processed record and is never revisited.
 *
 * @param {Activity[]} activities
 * @param {Set<string>} sportTypes
 * @returns {Activity|null}
 */
export function chooseSeedActivity(activities, sportTypes) {
  const found = newestFirst(activities).find((activity) => sportTypes.has(activity.sport_type));
  return found || null;
}
