/** @typedef {import('../ports/index.js').ActivityJob} ActivityJob */
/** @typedef {import('../ports/index.js').Job} Job */

/**
 * @param {number} athleteId
 * @param {number} activityId
 * @returns {ActivityJob}
 */
export function activityJob(athleteId, activityId) {
  return { type: 'activity.process', athleteId, activityId };
}

/**
 * The serialization key. Two webhook events for one activity — Strava's common
 * create-then-update pair — must run one after another, while unrelated
 * activities stay fully concurrent.
 *
 * @param {Job} job
 * @returns {string}
 */
export function jobKey(job) {
  switch (job.type) {
    case 'activity.process':
      return `activity:${job.activityId}`;
    default:
      throw new Error(`No key defined for job type: ${/** @type {any} */ (job).type}`);
  }
}
