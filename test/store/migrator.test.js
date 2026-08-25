import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../src/adapters/store/migrator.js';
import { openDatabase } from '../../src/adapters/store/connection.js';

test('applies every migration once and records the versions', () => {
  const db = new Database(':memory:');
  const first = migrate(db);

  assert.ok(first.applied.includes(1));
  assert.deepEqual(first.alreadyApplied, []);

  const allRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  // @ts-expect-error
  const tables = allRows.map((r) => r.name);
  for (const expected of ['athletes', 'processed_activities', 'invites', 'oauth_states', 'schema_migrations']) {
    assert.ok(tables.includes(expected), `missing table ${expected}`);
  }
});

test('is idempotent — a second run applies nothing', () => {
  const db = new Database(':memory:');
  migrate(db);
  const second = migrate(db);

  assert.deepEqual(second.applied, []);
  assert.ok(second.alreadyApplied.includes(1));
});

test('applies migrations in numeric order, not lexicographic', () => {
  // 10 must come after 2. Naive string sorting would put "010" before "002" only
  // by luck of zero-padding; this asserts the parse-and-sort is numeric.
  const db = new Database(':memory:');
  const { applied } = migrate(db);
  assert.deepEqual([...applied].sort((a, b) => a - b), applied);
});

test('openDatabase creates the file with mode 0600 and a working schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runsync-'));
  const file = path.join(dir, 'data.sqlite');
  try {
    const db = openDatabase(file);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'the file holds live refresh tokens');
    const athletesCountResult = db.prepare('SELECT COUNT(*) AS n FROM athletes').get();
    // @ts-expect-error
    assert.equal(athletesCountResult.n, 0);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('openDatabase reopens an existing database without re-migrating', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runsync-'));
  const file = path.join(dir, 'data.sqlite');
  try {
    openDatabase(file).close();
    const db = openDatabase(file);
    const migrationsCountResult = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    // @ts-expect-error
    assert.equal(migrationsCountResult.n, 2);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
