-- Bounds how long a processed-activity record is kept. Existing rows (from
-- before this migration) get 0, which is already in the past, so the first
-- purge after upgrade retires them immediately rather than keeping them
-- indefinitely under a false "not yet expired" reading.
ALTER TABLE processed_activities ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_processed_expires ON processed_activities (expires_at);
