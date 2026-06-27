-- Sampled gateway access-log feed: every non-2xx request plus a sample of 2xx,
-- captured from the gateway access log with the real client IP. Distinct from
-- `gateway_errors` (curated 5xx alert feed) — this is the searchable firehose.
CREATE TABLE IF NOT EXISTS gateway_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ts              timestamptz NOT NULL DEFAULT now(),
    method          text        NOT NULL,
    path            text        NOT NULL,
    status          int         NOT NULL,
    upstream_status int,
    host            text,
    client_ip       text,
    xff             text,
    latency_ms      bigint,
    upstream_addr   text,
    user_agent      text,
    bytes           bigint,
    request_id      text,
    has_auth        boolean
);

-- Keyset pagination (newest-first) + the common search facets.
CREATE INDEX IF NOT EXISTS gateway_requests_ts_id_idx ON gateway_requests (ts DESC, id DESC);
CREATE INDEX IF NOT EXISTS gateway_requests_client_ip_idx ON gateway_requests (client_ip);
CREATE INDEX IF NOT EXISTS gateway_requests_status_idx ON gateway_requests (status);
