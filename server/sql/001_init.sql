CREATE TABLE IF NOT EXISTS queue_entries (
  id UUID PRIMARY KEY,
  shop_code TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT,
  service_type TEXT,
  status TEXT NOT NULL DEFAULT 'waiting', -- waiting | called | served | canceled
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  called_at TIMESTAMP,
  served_at TIMESTAMP
);

-- Optional index to speed up ordered queries by shop
CREATE INDEX IF NOT EXISTS idx_queue_waiting ON queue_entries (shop_code, status, created_at);

