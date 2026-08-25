/** @typedef {import('better-sqlite3').Database} Database */
/** @typedef {import('../../ports/index.js').ActivityStore} ActivityStore */

/**
 * The durable idempotency record. Once an activity has a row here, the service
 * never touches it again — which is also what makes an athlete's deletion of
 * the message stick.
 * @param {Database} db
 * @returns {ActivityStore}
 */
export function createActivityStore(db) {
  const statements = {
    isProcessed: db.prepare('SELECT 1 FROM processed_activities WHERE activity_id = ?'),
    markProcessed: db.prepare(`
      INSERT OR IGNORE INTO processed_activities (activity_id, athlete_id, appended_at)
      VALUES (?, ?, ?)
    `),
    deleteProcessed: db.prepare('DELETE FROM processed_activities WHERE activity_id = ?'),
    recentFor: db.prepare(`
      SELECT activity_id, appended_at FROM processed_activities
      WHERE athlete_id = ? ORDER BY appended_at DESC LIMIT ?
    `),
    count: db.prepare('SELECT COUNT(*) AS n FROM processed_activities'),
  };

  return {
    isProcessed: (activityId) => statements.isProcessed.get(activityId) !== undefined,
    markProcessed: (activityId, athleteId, now) =>
      void statements.markProcessed.run(activityId, athleteId, now),
    deleteProcessed: (activityId) => void statements.deleteProcessed.run(activityId),
    recentFor: (athleteId, limit) =>
      /** @type {Array<{activity_id:number,appended_at:number}>} */ (statements.recentFor.all(athleteId, limit)),
    count: () => /** @type {{n:number}} */ (statements.count.get()).n,
  };
}
