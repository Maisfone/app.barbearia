CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY,
  shop_code TEXT NOT NULL,
  ticket_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  subscription JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_ticket ON push_subscriptions (ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_endpoint_ticket ON push_subscriptions (ticket_id, endpoint);

