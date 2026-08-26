import { openDatabase } from './adapters/store/connection.js';
import { createAthleteStore } from './adapters/store/athletes.js';
import { createActivityStore } from './adapters/store/activities.js';
import { createInviteStore } from './adapters/store/invites.js';
import { createAuthStateStore } from './adapters/store/authStates.js';
import { systemClock } from './adapters/clock.js';
import { createLogger } from './adapters/logger.js';
import { createStravaClient } from './adapters/strava/client.js';
import { createMailer } from './adapters/mail/smtp.js';
import { createTokenProvider } from './adapters/strava/tokens.js';
import { createInlineDispatcher } from './adapters/dispatch/inline.js';
import { createActivityProcessor } from './services/activityProcessor.js';
import { createConnectService } from './services/connectService.js';
import { createAthleteService } from './services/athleteService.js';
import { createDataDeletionService } from './services/dataDeletionService.js';
import { createSessions } from './web/session.js';

/** @param {import('./ports/index.js').Config} config */
export function buildContainer(config) {
  const clock = systemClock(); const logger = createLogger({ level: config.logLevel }); const db = openDatabase(config.dbPath);
  const athleteStore = createAthleteStore(db); const activityStore = createActivityStore(db); const inviteStore = createInviteStore(db); const authStateStore = createAuthStateStore(db);
  activityStore.purgeExpired(clock.now()); // Bound retention from the moment the process starts, not just on webhook traffic.
  const strava = createStravaClient({ config });
  const mailer = createMailer({ config });
  const dataDeletionService = createDataDeletionService({ db, athleteStore, activityStore, strava, logger });
  const tokens = createTokenProvider({ client: strava, athleteStore, dataDeletionService, clock, logger });
  const activityProcessor = createActivityProcessor({ athleteStore, activityStore, strava, tokens, dataDeletionService, config, clock, logger });
  const dispatcher = createInlineDispatcher({ handlers: { 'activity.process': (job) => activityProcessor.process(/** @type {any} */ (job)) }, logger });
  const connectService = createConnectService({ athleteStore, activityStore, inviteStore, authStateStore, strava, config, clock, logger });
  const athleteService = createAthleteService({ athleteStore, clock, logger }); let closed = false;
  return { config, db, clock, logger, athleteStore, activityStore, inviteStore, authStateStore, strava, mailer, tokens, dispatcher, activityProcessor, connectService, athleteService, dataDeletionService, sessions: createSessions(config.sessionSecret), close() { if (!closed) { closed = true; db.close(); } } };
}
