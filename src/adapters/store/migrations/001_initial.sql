CREATE TABLE athletes (
  athlete_id         INTEGER PRIMARY KEY,
  name               TEXT,
  refresh_token      TEXT NOT NULL,
  access_token       TEXT NOT NULL,
  expires_at         INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  message            TEXT,
  message_updated_at INTEGER,
  activity_cutoff    INTEGER NOT NULL,
  seed_activity_id   INTEGER,
  processed_count    INTEGER NOT NULL DEFAULT 0,
  last_activity_id   INTEGER,
  last_processed_at  INTEGER,
  last_error         TEXT,
  last_error_at      INTEGER,
  created_at         INTEGER NOT NULL,
  revoked_at         INTEGER
);

CREATE TABLE processed_activities (
  activity_id INTEGER PRIMARY KEY,
  athlete_id  INTEGER NOT NULL,
  appended_at INTEGER NOT NULL
);

CREATE INDEX idx_processed_athlete ON processed_activities (athlete_id, appended_at DESC);

CREATE TABLE invites (
  token       TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER,
  athlete_id  INTEGER
);

CREATE TABLE oauth_states (
  state           TEXT PRIMARY KEY,
  invite_token    TEXT,
  pending_message TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  consumed_at     INTEGER
);

CREATE INDEX idx_states_expiry ON oauth_states (expires_at);
