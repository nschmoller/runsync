import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('better-sqlite3').Database} Database */

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url).pathname;

/**
 * @returns {Array<{version: number, name: string, sql: string}>}
 */
function loadMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = /^(\d+)_/.exec(name);
      if (!match) throw new Error(`Migration ${name} must start with a number, e.g. 002_add_thing.sql`);
      return {
        version: Number(match[1]),
        name,
        sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'),
      };
    })
    // Numeric, not lexicographic: 10 must come after 2.
    .sort((a, b) => a.version - b.version);
}

/**
 * Applies every migration not yet recorded, each inside its own transaction.
 * @param {Database} db
 * @returns {{applied: number[], alreadyApplied: number[]}}
 */
export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  const allRows = db.prepare('SELECT version FROM schema_migrations').all();
  // @ts-expect-error
  const done = new Set(allRows.map((row) => row.version));

  const applied = [];
  const alreadyApplied = [];

  for (const migration of loadMigrations()) {
    if (done.has(migration.version)) {
      alreadyApplied.push(migration.version);
      continue;
    }
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Math.floor(Date.now() / 1000));
    });
    run();
    applied.push(migration.version);
  }

  return { applied, alreadyApplied };
}
