-- Grace window and arrival tracking
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS grace_expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP;

