/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../../ports/index.js').InviteStore} InviteStore */

/**
 * Slot control for the Standard Tier 10-athlete cap.
 * @param {Database} db
 * @returns {InviteStore}
 */
export function createInviteStore(db) {
  const statements = {
    create: db.prepare('INSERT INTO invites (token, created_at, expires_at) VALUES (?, ?, ?)'),
    getUsable: db.prepare(`
      SELECT * FROM invites WHERE token = ? AND consumed_at IS NULL AND expires_at > ?
    `),
    consume: db.prepare(`
      UPDATE invites SET consumed_at = ?, athlete_id = ? WHERE token = ? AND consumed_at IS NULL
    `),
    list: db.prepare('SELECT * FROM invites ORDER BY created_at DESC'),
  };

  return {
    create: ({ token, now, expiresAt }) => void statements.create.run(token, now, expiresAt),
    getUsable: (token, now) => /** @type {any} */ (statements.getUsable.get(token, now)),
    // The UPDATE ... WHERE consumed_at IS NULL is the single-use guarantee: a
    // replayed callback loses the race and gets false.
    consume: (token, athleteId, now) => statements.consume.run(now, athleteId, token).changes === 1,
    list: () => /** @type {any[]} */ (statements.list.all()),
  };
}
