import { ConflictError } from '../domain/errors.js';
import { resolveMessage, hasMessage, appendMessage } from '../domain/message.js';
import { computeCutoff, chooseSeedActivity, SEED_PAGE_SIZE } from '../domain/seeding.js';
import { LOCAL_DEV_INVITE_TOKEN, isLocalBaseUrl } from '../domain/localDev.js';

/** @typedef {import('../ports/index.js').ActivityStore} ActivityStore */
/** @typedef {import('../ports/index.js').AthleteStore} AthleteStore */
/** @typedef {import('../ports/index.js').AuthStateStore} AuthStateStore */
/** @typedef {import('../ports/index.js').Clock} Clock */
/** @typedef {import('../ports/index.js').Config} Config */
/** @typedef {import('../ports/index.js').InviteStore} InviteStore */
/** @typedef {import('../ports/index.js').Logger} Logger */
/** @typedef {import('../ports/index.js').StravaClient} StravaClient */

/**
 * @param {{athleteStore: AthleteStore, activityStore: ActivityStore, inviteStore: InviteStore, authStateStore: AuthStateStore, strava: StravaClient, config: Config, clock: Clock, logger: Logger}} deps
 */
export function createConnectService({ athleteStore, activityStore, inviteStore, authStateStore, strava, config, clock, logger }) {
  /** @param {number} athleteId @param {string} accessToken */
  async function seedAthlete(athleteId, accessToken) {
    const athlete = athleteStore.get(athleteId);
    if (!athlete) throw new ConflictError(`Unknown athlete ${athleteId}`);

    const activities = await strava.listRecentActivities(accessToken, SEED_PAGE_SIZE);
    const cutoff = computeCutoff(activities, clock.now());
    athleteStore.advanceCutoff(athleteId, cutoff);
    const seed = chooseSeedActivity(activities, config.sportTypes);
    if (!seed) {
      logger.info('connect.no-seed', { athleteId, considered: activities.length });
      return { cutoff, seedActivityId: null };
    }

    const message = resolveMessage(athlete, config);
    const full = await strava.getActivity(accessToken, seed.id);
    if (!hasMessage(full.description, message)) {
      await strava.updateActivity(accessToken, seed.id, { description: appendMessage(full.description, message) });
    }
    activityStore.markProcessed(seed.id, athleteId, clock.now());
    athleteStore.setSeedActivity(athleteId, seed.id);
    athleteStore.recordSuccess(athleteId, seed.id, clock.now());
    logger.info('connect.seeded', { athleteId, activityId: seed.id, cutoff });
    return { cutoff, seedActivityId: seed.id };
  }

  return {
    seedAthlete,
    /** @param {{code: string, state: string}} input */
    async completeConnect({ code, state }) {
      const stored = authStateStore.consume(state, clock.now());
      if (!stored) throw new ConflictError('This sign-in link has expired. Please start again.');

      const identity = await strava.exchangeCode(code);
      const existing = athleteStore.get(identity.athleteId);
      if (!stored.invite_token) {
        if (!existing) throw new ConflictError('You need an invite link to connect.');
        const wasRevoked = existing.status === 'revoked';
        athleteStore.reactivate(identity.athleteId, identity);
        if (wasRevoked) {
          athleteStore.advanceCutoff(identity.athleteId, clock.now());
          logger.info('connect.reauthorized', { athleteId: identity.athleteId });
        }
        return { athleteId: identity.athleteId, isNew: false };
      }

      const isLocalDevSignup = stored.invite_token === LOCAL_DEV_INVITE_TOKEN && isLocalBaseUrl(config.baseUrl);
      if (!isLocalDevSignup && !inviteStore.consume(stored.invite_token, identity.athleteId, clock.now())) {
        throw new ConflictError('This invite link has already been used.');
      }
      athleteStore.insert({
        athleteId: identity.athleteId, name: identity.name, refreshToken: identity.refreshToken,
        accessToken: identity.accessToken, expiresAt: identity.expiresAt, message: stored.pending_message,
        activityCutoff: clock.now(), now: clock.now(),
      });
      logger.info('connect.completed', { athleteId: identity.athleteId });
      try {
        await seedAthlete(identity.athleteId, identity.accessToken);
      } catch (error) {
        logger.error('connect.seed-failed', {
          athleteId: identity.athleteId, error: error instanceof Error ? error.message : String(error),
        });
      }
      return { athleteId: identity.athleteId, isNew: true };
    },
  };
}
