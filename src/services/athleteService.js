import { validateMessage } from '../domain/message.js';

/** @typedef {import('../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../ports/index.js').Clock} Clock */
/** @typedef {import('../ports/index.js').Logger} Logger */
/** @typedef {import('../ports/index.js').StravaClient} StravaClient */

/** @param {{athleteStore: AthleteStore, strava: Pick<StravaClient, 'deauthorize'>, clock: Clock, logger: Logger}} deps */
export function createAthleteService({ athleteStore, strava, clock, logger }) {
  return {
    /** @param {number} athleteId @param {string|null|undefined} rawMessage */
    updateMessage(athleteId, rawMessage) {
      const validated = validateMessage(rawMessage);
      if (!validated.ok) return { ok: false, error: validated.error };
      athleteStore.setMessage(athleteId, validated.value, clock.now());
      logger.info('athlete.message-changed', { athleteId, usingDefault: validated.value === null });
      return { ok: true };
    },
    /** @param {number} athleteId */
    async disconnect(athleteId) {
      const athlete = athleteStore.get(athleteId);
      if (!athlete) return;
      try {
        await strava.deauthorize(athlete.access_token);
      } catch (error) {
        logger.error('athlete.deauthorize-failed', { athleteId, error: error instanceof Error ? error.message : String(error) });
      }
      athleteStore.markRevoked(athleteId, clock.now());
      logger.info('athlete.disconnected', { athleteId });
    },
  };
}
