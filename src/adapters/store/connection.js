import fs from 'node:fs';
import Database from 'better-sqlite3';
import { migrate } from './migrator.js';

/**
 * @param {string} filePath
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(filePath) {
  const isNew = filePath !== ':memory:' && !fs.existsSync(filePath);
  const db = new Database(filePath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  migrate(db);

  // The file holds live refresh tokens — credentials for write access to
  // someone else's Strava account.
  if (isNew) fs.chmodSync(filePath, 0o600);

  return db;
}
