-- 0006_gateway_errors.sql
-- Persisted API-gateway 5xx errors. A background tailer parses the gateway's
-- access log and records every >=500 response here, so 502/503 spikes have a
-- durable history independent of pod/log retention.
CREATE TABLE IF NOT EXISTS gateway_errors (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
    method          TEXT        NOT NULL,
    path            TEXT        NOT NULL,
    status          INT         NOT NULL,
    upstream_status INT,
    host            TEXT,
    client_ip       TEXT,
    latency_ms      BIGINT,
    upstream_addr   TEXT,
    user_agent      TEXT
);

CREATE INDEX IF NOT EXISTS idx_gateway_errors_ts_id ON gateway_errors (ts DESC, id DESC);
