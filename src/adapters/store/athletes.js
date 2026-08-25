/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../../ports/index.js').Athlete} Athlete */
/** @typedef {import('../../ports/index.js').AthleteStore} AthleteStore */

const MAX_ERROR_LENGTH = 500;

/**
 * @param {Database} db
 * @returns {AthleteStore}
 */
export function createAthleteStore(db) {
  const statements = {
    get: db.prepare('SELECT * FROM athletes WHERE athlete_id = ?'),
    insert: db.prepare(`
      INSERT INTO athletes (athlete_id, name, refresh_token, access_token, expires_at,
                            status, message, message_updated_at, activity_cutoff, created_at)
      VALUES (@athleteId, @name, @refreshToken, @accessToken, @expiresAt,
              'active', @message, @messageUpdatedAt, @activityCutoff, @now)
      ON CONFLICT(athlete_id) DO UPDATE SET
        name = excluded.name,
        refresh_token = excluded.refresh_token,
        access_token = excluded.access_token,
        expires_at = excluded.expires_at,
        status = 'active',
        revoked_at = NULL
    `),
    updateTokens: db.prepare(`
      UPDATE athletes SET access_token = ?, refresh_token = ?, expires_at = ? WHERE athlete_id = ?
    `),
    setMessage: db.prepare('UPDATE athletes SET message = ?, message_updated_at = ? WHERE athlete_id = ?'),
    setSeedActivity: db.prepare('UPDATE athletes SET seed_activity_id = ? WHERE athlete_id = ?'),
    advanceCutoff: db.prepare(`
      UPDATE athletes SET activity_cutoff = ? WHERE athlete_id = ? AND activity_cutoff < ?
    `),
    markRevoked: db.prepare(`UPDATE athletes SET status = 'revoked', revoked_at = ? WHERE athlete_id = ?`),
    reactivate: db.prepare(`
      UPDATE athletes SET status = 'active', revoked_at = NULL,
             access_token = ?, refresh_token = ?, expires_at = ?
      WHERE athlete_id = ?
    `),
    recordSuccess: db.prepare(`
      UPDATE athletes SET processed_count = processed_count + 1, last_activity_id = ?,
             last_processed_at = ?, last_error = NULL, last_error_at = NULL
      WHERE athlete_id = ?
    `),
    recordError: db.prepare('UPDATE athletes SET last_error = ?, last_error_at = ? WHERE athlete_id = ?'),
    list: db.prepare('SELECT * FROM athletes ORDER BY created_at DESC'),
    countActive: db.prepare(`SELECT COUNT(*) AS n FROM athletes WHERE status = 'active'`),
    remove: db.prepare('DELETE FROM athletes WHERE athlete_id = ?'),
  };

  return {
    get: (athleteId) => /** @type {Athlete|undefined} */ (statements.get.get(athleteId)),

    insert: (input) => {
      // ON CONFLICT deliberately does NOT touch message or activity_cutoff: a
      // reconnect must not wipe the athlete's own text or reopen their history.
      statements.insert.run({
        ...input,
        messageUpdatedAt: input.message === null ? null : input.now,
      });
    },

    updateTokens: (athleteId, { accessToken, refreshToken, expiresAt }) =>
      void statements.updateTokens.run(accessToken, refreshToken, expiresAt, athleteId),

    setMessage: (athleteId, message, now) =>
      void statements.setMessage.run(message, now, athleteId),

    setSeedActivity: (athleteId, activityId) =>
      void statements.setSeedActivity.run(activityId, athleteId),

    advanceCutoff: (athleteId, cutoff) =>
      void statements.advanceCutoff.run(cutoff, athleteId, cutoff),

    markRevoked: (athleteId, now) => void statements.markRevoked.run(now, athleteId),

    reactivate: (athleteId, { accessToken, refreshToken, expiresAt }) =>
      void statements.reactivate.run(accessToken, refreshToken, expiresAt, athleteId),

    recordSuccess: (athleteId, activityId, now) =>
      void statements.recordSuccess.run(activityId, now, athleteId),

    recordError: (athleteId, message, now) =>
      void statements.recordError.run(String(message).slice(0, MAX_ERROR_LENGTH), now, athleteId),

    list: () => /** @type {Athlete[]} */ (statements.list.all()),

    countActive: () => /** @type {{n: number}} */ (statements.countActive.get()).n,

    remove: (athleteId) => void statements.remove.run(athleteId),
  };
}
