import Database from 'better-sqlite3';
import { migrate } from '../../src/adapters/store/migrator.js';
import { createAthleteStore } from '../../src/adapters/store/athletes.js';

export const NOW = 1_800_000_000;

export function testDb() {
  const db = new Database(':memory:');
  migrate(db);
  return db;
}

/** @param {number} [t] @returns {import('../../src/ports/index.js').Clock} */
export function fixedClock(t = NOW) {
  return { now: () => t };
}

/** A logger that records rather than prints, so tests can assert on events. */
export function collectingLogger() {
  const entries = /** @type {any[]} */ ([]);
  /** @param {Record<string, any>} [context] */
  const make = (context = {}) => ({
    /** @param {string} event @param {Record<string, any>} [fields] */
    debug: (event, fields) => entries.push({ level: 'debug', event, ...context, ...fields }),
    /** @param {string} event @param {Record<string, any>} [fields] */
    info: (event, fields) => entries.push({ level: 'info', event, ...context, ...fields }),
    /** @param {string} event @param {Record<string, any>} [fields] */
    warn: (event, fields) => entries.push({ level: 'warn', event, ...context, ...fields }),
    /** @param {string} event @param {Record<string, any>} [fields] */
    error: (event, fields) => entries.push({ level: 'error', event, ...context, ...fields }),
    /** @param {Record<string, any>} fields */
    child: (fields) => make({ ...context, ...fields }),
  });
  /** @type {any} */
  const logger = make({});
  logger.entries = entries;
  return logger;
}

/** @param {Partial<import('../../src/ports/index.js').Config>} [overrides] */
export function testConfig(overrides = {}) {
  return {
    clientId: '12345',
    clientSecret: 'secret',
    webhookVerifyToken: 'verify',
    subscriptionId: 77,
    appendMessage: '🏃 Synced via racegoal',
    sportTypes: new Set(['Run', 'TrailRun']),
    sessionSecret: 'a'.repeat(32),
    baseUrl: 'https://racegoal.example.com',
    port: 3000,
    dbPath: ':memory:',
    adminAthleteIds: new Set(),
    logLevel: /** @type {const} */ ('info'),
    supportEmail: 'support@racegoal.example.com',
    ...overrides,
  };
}

/**
 * Inserts an athlete and returns the stored row.
 * @param {import('better-sqlite3').Database} db
 */
export function makeAthlete(db, overrides = {}) {
  const store = createAthleteStore(db);
  const input = {
    athleteId: 987654,
    name: 'Test Athlete',
    refreshToken: 'refresh-1',
    accessToken: 'access-1',
    expiresAt: NOW + 21_600,
    message: null,
    activityCutoff: NOW - 100_000,
    now: NOW,
    ...overrides,
  };
  store.insert(input);
  return store.get(input.athleteId);
}
