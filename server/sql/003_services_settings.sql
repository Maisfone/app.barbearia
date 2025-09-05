-- Services offered per shop
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY,
  shop_code TEXT NOT NULL,
  name TEXT NOT NULL,
  duration_minutes INT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_services_shop_active ON services (shop_code, active, name);

-- Shop settings: pause queue and message
CREATE TABLE IF NOT EXISTS shop_settings (
  shop_code TEXT PRIMARY KEY,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  pause_message TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

