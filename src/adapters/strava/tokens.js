import { createKeyedLock } from '../lock.js';
import { isAuthError } from './errors.js';

/** @typedef {import('../../ports/index.js').Athlete} Athlete */
/** @typedef {import('../../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../../ports/index.js').Clock} Clock */
/** @typedef {import('../../ports/index.js').Logger} Logger */
/** @typedef {import('../../ports/index.js').StravaClient} StravaClient */
/** @typedef {import('../../ports/index.js').TokenProvider} TokenProvider */

/** Refresh this far before actual expiry, so a slow request cannot straddle it. */
export const REFRESH_SKEW_SECONDS = 300;

/**
 * @param {{ client: Pick<StravaClient,'refresh'>, athleteStore: AthleteStore, clock: Clock, logger: Logger }} deps
 * @returns {TokenProvider}
 */
export function createTokenProvider({ client, athleteStore, clock, logger }) {
  const withAthleteLock = createKeyedLock();

  /** @param {Athlete} athlete */
  async function refresh(athlete) {
    let tokens;
    try {
      tokens = await client.refresh(athlete.refresh_token);
    } catch (error) {
      if (isAuthError(error)) {
        athleteStore.markRevoked(athlete.athlete_id, clock.now());
        logger.warn('athlete.revoked', { athleteId: athlete.athlete_id, cause: 'refresh-401' });
      }
      throw error;
    }

    athleteStore.updateTokens(athlete.athlete_id, tokens);
    logger.info('token.refreshed', { athleteId: athlete.athlete_id, expiresAt: tokens.expiresAt });
    return tokens.accessToken;
  }

  return {
    /**
     * Strava rotates the refresh token on every refresh, invalidating the
     * previous one. Two concurrent refreshes for one athlete would race and
     * disconnect them, so the whole path is serialized per athlete id.
     *
     * The re-read INSIDE the lock is what makes a queued caller reuse the
     * first caller's freshly persisted token instead of replaying a refresh
     * token that has already been spent.
     */
    accessTokenFor(athlete) {
      return withAthleteLock(athlete.athlete_id, async () => {
        const current = athleteStore.get(athlete.athlete_id) ?? athlete;
        if (current.expires_at > clock.now() + REFRESH_SKEW_SECONDS) return current.access_token;
        return refresh(current);
      });
    },
  };
}
