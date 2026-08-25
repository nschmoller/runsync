/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../../ports/index.js').AuthStateStore} AuthStateStore */

/**
 * CSRF protection for the OAuth round trip, and the carrier for the invite
 * token and the message chosen on the connect page — neither of which may be
 * read back from a user-supplied query parameter.
 * @param {Database} db
 * @returns {AuthStateStore}
 */
export function createAuthStateStore(db) {
  const statements = {
    create: db.prepare(`
      INSERT INTO oauth_states (state, invite_token, pending_message, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    claim: db.prepare(`
      UPDATE oauth_states SET consumed_at = ?
      WHERE state = ? AND consumed_at IS NULL AND expires_at > ?
    `),
    read: db.prepare('SELECT * FROM oauth_states WHERE state = ?'),
    sweep: db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?'),
  };

  const consume = db.transaction((state, now) => {
    if (statements.claim.run(now, state, now).changes !== 1) return undefined;
    return statements.read.get(state);
  });

  return {
    create: ({ state, inviteToken, pendingMessage, now, expiresAt }) => {
      statements.sweep.run(now);
      statements.create.run(state, inviteToken, pendingMessage, now, expiresAt);
    },
    consume: (state, now) => /** @type {any} */ (consume(state, now)),
    sweep: (now) => void statements.sweep.run(now),
  };
}
