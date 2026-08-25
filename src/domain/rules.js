import { resolveMessage, hasMessage, appendMessage } from './message.js';

/** @typedef {import('../ports/index.js').Athlete} Athlete */
/** @typedef {import('../ports/index.js').Activity} Activity */
/** @typedef {import('../ports/index.js').Config} Config */
/** @typedef {import('../ports/index.js').PreFetchDecision} PreFetchDecision */
/** @typedef {import('../ports/index.js').PostFetchDecision} PostFetchDecision */

/** @param {{ start_date: string }} activity @returns {number} unix seconds */
export function startedAt(activity) {
  return Math.floor(new Date(activity.start_date).getTime() / 1000);
}

/**
 * Decided with no Strava call made, so a re-delivered or irrelevant event costs
 * nothing against the rate limit.
 *
 * @param {{ athlete: Athlete|undefined, alreadyProcessed: boolean }} input
 * @returns {PreFetchDecision}
 */
export function decidePreFetch({ athlete, alreadyProcessed }) {
  if (!athlete) return { action: 'skip', reason: 'unknown-athlete' };
  if (athlete.status !== 'active') return { action: 'skip', reason: 'revoked' };
  if (alreadyProcessed) return { action: 'skip', reason: 'already-processed' };
  return { action: 'fetch' };
}

/**
 * Decided once the activity is in hand. Add future rules here — a new branch
 * plus a new test, with nothing in services/ or web/ to change.
 *
 * @param {{ athlete: Athlete, activity: Activity, config: Config }} input
 * @returns {PostFetchDecision}
 */
export function decidePostFetch({ athlete, activity, config }) {
  // Cutoff first: an edit to a years-old activity is the case this exists for,
  // and reporting it as `before-cutoff` rather than `wrong-sport` keeps the logs
  // honest about why it was dropped.
  if (startedAt(activity) <= athlete.activity_cutoff) {
    return { action: 'skip', reason: 'before-cutoff' };
  }

  if (!config.sportTypes.has(activity.sport_type)) {
    return { action: 'skip', reason: 'wrong-sport' };
  }

  const message = resolveMessage(athlete, config);

  if (hasMessage(activity.description, message)) {
    return { action: 'record', reason: 'backfill' };
  }

  return { action: 'append', description: appendMessage(activity.description, message) };
}
