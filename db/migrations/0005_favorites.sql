-- 0005_favorites.sql
-- Per-user favorites: pin any resource (workload, pod, namespace, node, build,
-- user) for one-click access from the Favorites page. Keyed by the console
-- username; (username, kind, namespace, name) is unique so re-favoriting is a
-- no-op.
CREATE TABLE IF NOT EXISTS favorites (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username   TEXT        NOT NULL,
    kind       TEXT        NOT NULL,
    namespace  TEXT        NOT NULL DEFAULT '',
    name       TEXT        NOT NULL,
    -- The in-app link to open the resource (e.g. /services/<ns>/<name>).
    href       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (username, kind, namespace, name)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (username, created_at DESC);
