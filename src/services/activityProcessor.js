import { decidePreFetch, decidePostFetch } from '../domain/rules.js';
import { isAuthError } from '../adapters/strava/errors.js';

/** @typedef {import('../ports/index.js').ActivityJob} ActivityJob */
/** @typedef {import('../ports/index.js').ActivityStore} ActivityStore */
/** @typedef {import('../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../ports/index.js').Clock} Clock */
/** @typedef {import('../ports/index.js').Config} Config */
/** @typedef {import('../ports/index.js').DataDeletionService} DataDeletionService */
/** @typedef {import('../ports/index.js').Logger} Logger */
/** @typedef {import('../ports/index.js').StravaClient} StravaClient */
/** @typedef {import('../ports/index.js').TokenProvider} TokenProvider */

/**
 * Orchestration only. Every branch that decides *whether* to act lives in
 * domain/rules.js; this service loads state, asks, and carries out the answer.
 *
 * @param {{
 *   athleteStore: AthleteStore,
 *   activityStore: ActivityStore,
 *   strava: Pick<StravaClient,'getActivity'|'updateActivity'>,
 *   tokens: TokenProvider,
 *   dataDeletionService: DataDeletionService,
 *   config: Config,
 *   clock: Clock,
 *   logger: Logger,
 * }} deps
 */
export function createActivityProcessor({ athleteStore, activityStore, strava, tokens, dataDeletionService, config, clock, logger }) {
  /** @param {ActivityJob} job @returns {Promise<string>} */
  async function run({ athleteId, activityId }) {
    const log = logger.child({ athleteId, activityId });
    const athlete = athleteStore.get(athleteId);

    const pre = decidePreFetch({ athlete, alreadyProcessed: activityStore.isProcessed(activityId) });
    if (pre.action === 'skip') {
      log.info('activity.skipped', { reason: pre.reason });
      return pre.reason;
    }

    const token = await tokens.accessTokenFor(/** @type {NonNullable<typeof athlete>} */ (athlete));
    const activity = await strava.getActivity(token, activityId);

    const post = decidePostFetch({
      athlete: /** @type {NonNullable<typeof athlete>} */ (athlete),
      activity,
      config,
    });

    if (post.action === 'skip') {
      log.info('activity.skipped', { reason: post.reason, sportType: activity.sport_type });
      return post.reason;
    }

    if (post.action === 'record') {
      // Already carries the message — back-fill the durable record so we never
      // look at it again, without spending a write against the rate limit.
      activityStore.markProcessed(activityId, athleteId, clock.now());
      log.info('activity.backfilled', {});
      return post.reason;
    }

    await strava.updateActivity(token, activityId, { description: post.description });
    activityStore.markProcessed(activityId, athleteId, clock.now());
    athleteStore.recordSuccess(athleteId, activityId, clock.now());
    log.info('activity.appended', {});
    return 'appended';
  }

  return {
    /** @param {ActivityJob} job */
    async process(job) {
      try {
        return await run(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('activity.failed', { athleteId: job.athleteId, activityId: job.activityId, error: message });
        // Surfaced on the athlete's own dashboard, so a miss is visible to them
        // without anyone reading container logs.
        if (athleteStore.get(job.athleteId)) {
          // The deauthorization webhook is not guaranteed to arrive, so a 401
          // seen here is the backstop that stops a dead row failing forever —
          // and, since we can no longer act on their behalf, erases it rather
          // than keeping it around in a revoked-but-retained state. Recording
          // the error would be pointless: the row is about to be gone.
          if (isAuthError(error)) {
            logger.warn('athlete.revoked', { athleteId: job.athleteId, cause: 'activity-401' });
            await dataDeletionService.deleteAthleteData(job.athleteId, { reason: 'activity-401' });
          } else {
            athleteStore.recordError(job.athleteId, message, clock.now());
          }
        }
        throw error;
      }
    },
  };
}
