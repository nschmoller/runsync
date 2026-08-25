import { validateMessage } from '../domain/message.js';

/** @typedef {import('../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../ports/index.js').Clock} Clock */
/** @typedef {import('../ports/index.js').Logger} Logger */

/**
 * Account deletion lives in dataDeletionService.js, not here — it is one
 * action shared by the user's own request, the deauthorization webhook, and a
 * detected auth failure, so it has a single home.
 * @param {{athleteStore: AthleteStore, clock: Clock, logger: Logger}} deps
 */
export function createAthleteService({ athleteStore, clock, logger }) {
  return {
    /** @param {number} athleteId @param {string|null|undefined} rawMessage */
    updateMessage(athleteId, rawMessage) {
      const validated = validateMessage(rawMessage);
      if (!validated.ok) return { ok: false, error: validated.error };
      athleteStore.setMessage(athleteId, validated.value, clock.now());
      logger.info('athlete.message-changed', { athleteId, usingDefault: validated.value === null });
      return { ok: true };
    },
  };
}
