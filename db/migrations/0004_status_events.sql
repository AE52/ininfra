-- 0004_status_events.sql
-- Status page engine: one row per observed health *transition* of a monitored
-- component (Deployment / StatefulSet). A background monitor records a row only
-- when a component's status changes, which is enough to reconstruct incidents
-- (down intervals) and compute uptime% over any window.
CREATE TABLE IF NOT EXISTS status_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind        TEXT        NOT NULL,   -- 'Deployment' | 'StatefulSet'
    namespace   TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    status      TEXT        NOT NULL,   -- healthy | progressing | degraded | unknown
    prev_status TEXT,                   -- previous status; NULL for the first observation
    detail      JSONB       NOT NULL DEFAULT '{}'::jsonb  -- replicas ready/desired etc.
);

CREATE INDEX IF NOT EXISTS idx_status_events_comp_ts ON status_events (namespace, name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_status_events_ts_id ON status_events (ts DESC, id DESC);
