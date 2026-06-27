-- 0003_error_events.sql
-- Sentry-style error feed: every failed request (HTTP >= 400) the API serves,
-- plus client-reported JS errors, captured WITH the acting user so an admin can
-- see exactly which user hit which error. Separate from audit_log (which records
-- intentional successful mutations); this is the failure/observability stream.
CREATE TABLE IF NOT EXISTS error_events (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Who hit it (the authenticated username), or NULL if unauthenticated.
    username   TEXT,
    -- 'server' (API request failed) or 'client' (browser-reported JS error).
    source     TEXT        NOT NULL DEFAULT 'server',
    method     TEXT,
    path       TEXT,
    status     INT,
    -- ApiError code (server) or error name (client).
    code       TEXT,
    message    TEXT        NOT NULL,
    detail     JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- Keyset pagination, newest-first.
CREATE INDEX IF NOT EXISTS idx_error_events_ts_id ON error_events (ts DESC, id DESC);
