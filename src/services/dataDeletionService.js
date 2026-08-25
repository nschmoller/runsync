/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../ports/index.js').ActivityStore} ActivityStore */
/** @typedef {import('../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../ports/index.js').DataDeletionService} DataDeletionService */
/** @typedef {import('../ports/index.js').Logger} Logger */
/** @typedef {import('../ports/index.js').StravaClient} StravaClient */

/**
 * The single place that permanently erases an athlete: attempts Strava
 * deauthorization on a best-effort basis, then deletes the athlete row and
 * every processed-activity row for them in one transaction. Called from three
 * places — the user's own delete-account request, the deauthorization
 * webhook, and a detected auth failure — so retention never depends on all
 * three firing.
 *
 * @param {{db: Database, athleteStore: AthleteStore, activityStore: ActivityStore, strava: Pick<StravaClient,'deauthorize'>, logger: Logger}} deps
 * @returns {DataDeletionService}
 */
export function createDataDeletionService({ db, athleteStore, activityStore, strava, logger }) {
  const eraseRows = db.transaction((/** @type {number} */ athleteId) => {
    activityStore.deleteForAthlete(athleteId);
    athleteStore.remove(athleteId);
  });

  return {
    async deleteAthleteData(athleteId, { reason = 'unspecified' } = {}) {
      const athlete = athleteStore.get(athleteId);
      if (!athlete) return; // Already gone — idempotent.

      try {
        await strava.deauthorize(athlete.access_token);
      } catch (error) {
        // The upstream call is best-effort: a stale or already-revoked token
        // must never block permanently erasing our own copy of their data.
        logger.warn('athlete.deauthorize-failed', {
          athleteId, reason, error: error instanceof Error ? error.message : String(error),
        });
      }

      eraseRows(athleteId);
      logger.info('athlete.data-deleted', { athleteId, reason });
    },
  };
}
