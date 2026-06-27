-- 0009_k8s_events.sql
-- Persisted Kubernetes event store: the collector (monitor::spawn_events) upserts
-- events from every managed namespace every ~45s, retaining up to EVENT_RETENTION_DAYS
-- (default 7) worth of history. This outlasts the native k8s event TTL (~1h).
CREATE TABLE IF NOT EXISTS k8s_events (
    id            BIGSERIAL    PRIMARY KEY,
    namespace     TEXT         NOT NULL,
    -- "Normal" or "Warning"
    type          TEXT         NOT NULL DEFAULT '',
    reason        TEXT         NOT NULL DEFAULT '',
    message       TEXT         NOT NULL DEFAULT '',
    involved_kind TEXT         NOT NULL DEFAULT '',
    involved_name TEXT         NOT NULL DEFAULT '',
    count         INT          NOT NULL DEFAULT 1,
    first_seen    TIMESTAMPTZ,
    last_seen     TIMESTAMPTZ,
    source        TEXT,
    -- Wall-clock time this row was written/updated in the console DB.
    observed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Primary query: newest events for a namespace.
CREATE INDEX IF NOT EXISTS idx_k8s_events_last_seen
    ON k8s_events (last_seen DESC);

-- Per-namespace newest-first (the common hot path).
CREATE INDEX IF NOT EXISTS idx_k8s_events_ns_last_seen
    ON k8s_events (namespace, last_seen DESC);

-- Dedup / upsert key: one logical "event stream" per (namespace, kind, name, reason, message).
-- The collector uses this constraint with ON CONFLICT to update count + last_seen.
CREATE UNIQUE INDEX IF NOT EXISTS idx_k8s_events_dedup
    ON k8s_events (namespace, involved_kind, involved_name, reason, message);
