import express from 'express';
import { isLocalBaseUrl } from '../../domain/localDev.js';

export const DEV_ATHLETE_ID = 999999999;

/**
 * Logs in as a fake athlete without touching Strava, so the dashboard can be
 * exercised locally. Only mounted when BASE_URL is localhost/127.0.0.1.
 * @param {{config:any,athleteStore:any,sessions:any,clock:any,logger:any}} deps
 */
export function devAuthRouter({ config, athleteStore, sessions, clock, logger }) {
  const router = express.Router();
  if (!isLocalBaseUrl(config.baseUrl)) return router;

  router.get('/dev/login', (_req, res) => {
    const now = clock.now();
    athleteStore.insert({
      athleteId: DEV_ATHLETE_ID, name: 'Dev Athlete', refreshToken: 'dev', accessToken: 'dev',
      expiresAt: now + 3600, message: config.appendMessage, activityCutoff: now, now,
    });
    res.cookie(sessions.COOKIE_NAME, sessions.sign(DEV_ATHLETE_ID, now + sessions.MAX_AGE_SECONDS), sessions.cookieOptions());
    logger.info('dev.login', { athleteId: DEV_ATHLETE_ID });
    return res.redirect(302, '/dashboard');
  });

  return router;
}
