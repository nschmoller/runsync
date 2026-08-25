/** @typedef {import('./ports/index.js').Config} Config */

const REQUIRED = [
  'STRAVA_CLIENT_ID',
  'STRAVA_CLIENT_SECRET',
  'STRAVA_WEBHOOK_VERIFY_TOKEN',
  'APPEND_MESSAGE',
  'SESSION_SECRET',
  'BASE_URL',
  'SUPPORT_EMAIL',
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_SPORT_TYPES = 'Run,TrailRun';
const MIN_SECRET_LENGTH = 32;
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/** @param {string|undefined} value @returns {string[]} */
function csv(value) {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key] || env[key].trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const sessionSecret = /** @type {string} */ (env.SESSION_SECRET);
  if (sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const sportTypes = new Set(csv(env.SPORT_TYPES ?? DEFAULT_SPORT_TYPES));
  if (sportTypes.size === 0) throw new Error('SPORT_TYPES must list at least one sport type');

  const adminAthleteIds = new Set(csv(env.ADMIN_ATHLETE_IDS).map((entry) => {
    if (!/^\d+$/.test(entry)) throw new Error(`ADMIN_ATHLETE_IDS contains a non-numeric entry: ${entry}`);
    return Number(entry);
  }));

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  }

  const supportEmail = /** @type {string} */ (env.SUPPORT_EMAIL);
  if (!EMAIL_PATTERN.test(supportEmail)) {
    throw new Error('SUPPORT_EMAIL must be a valid email address');
  }

  return {
    clientId: /** @type {string} */ (env.STRAVA_CLIENT_ID),
    clientSecret: /** @type {string} */ (env.STRAVA_CLIENT_SECRET),
    webhookVerifyToken: /** @type {string} */ (env.STRAVA_WEBHOOK_VERIFY_TOKEN),
    subscriptionId: env.STRAVA_SUBSCRIPTION_ID ? Number(env.STRAVA_SUBSCRIPTION_ID) : null,
    appendMessage: /** @type {string} */ (env.APPEND_MESSAGE),
    sportTypes,
    sessionSecret,
    baseUrl: /** @type {string} */ (env.BASE_URL).replace(/\/+$/, ''),
    port: Number(env.PORT ?? 3000),
    dbPath: env.DB_PATH ?? './data.sqlite',
    adminAthleteIds,
    logLevel: /** @type {'debug'|'info'|'warn'|'error'} */ (logLevel),
    supportEmail,
  };
}
