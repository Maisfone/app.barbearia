-- Add ticket_number and ticket_date to entries
ALTER TABLE queue_entries
  ADD COLUMN IF NOT EXISTS ticket_number INT,
  ADD COLUMN IF NOT EXISTS ticket_date DATE DEFAULT CURRENT_DATE;

-- Ensure uniqueness of number per shop per day
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_per_day
  ON queue_entries (shop_code, ticket_date, ticket_number)
  WHERE ticket_number IS NOT NULL;

-- Counter table to safely allocate next number per shop/day
CREATE TABLE IF NOT EXISTS queue_counters (
  shop_code TEXT NOT NULL,
  counter_date DATE NOT NULL,
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_code, counter_date)
);
