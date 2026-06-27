-- 0001_init.sql
-- Schema for the inInfra Console.
--
-- Two tables:
--   * audit_log     — append-only record of every mutating action taken through
--                     the console. Maps to the `AuditEntry` DTO in
--                     @ininfra/shared-types and is read back as a cursor-paginated
--                     `Page<AuditEntry>` (ts DESC, id tiebreak).
--   * saved_views   — user-saved console views / filters + a small key/value
--                     config store (kind='config'). Free-form JSON payload.
--
-- gen_random_uuid() requires pgcrypto (bundled with Postgres 13+ as a built-in,
-- but enable the extension defensively so this runs on stock images).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------ --
-- audit_log                                                           --
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor       TEXT        NOT NULL,
    -- Mirrors the `AuditAction` union in shared-types. Stored as TEXT (not a
    -- PG enum) so adding a verb is a code-only change, no migration needed.
    action      TEXT        NOT NULL,
    target_ns   TEXT,
    target_kind TEXT,
    target_name TEXT,
    detail      JSONB       NOT NULL DEFAULT '{}'::jsonb
);

-- Common query patterns: recent-first global feed (cursor = ts,id), per-actor,
-- and per-target history. The (ts DESC, id DESC) index backs keyset pagination.
CREATE INDEX IF NOT EXISTS idx_audit_log_ts_id ON audit_log (ts DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor);
CREATE INDEX IF NOT EXISTS idx_audit_log_target
    ON audit_log (target_ns, target_kind, target_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_detail ON audit_log USING gin (detail);

-- ------------------------------------------------------------------ --
-- saved_views (also doubles as a key/value config store)              --
-- ------------------------------------------------------------------ --
CREATE TABLE IF NOT EXISTS saved_views (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 'view'  = a named, user-saved console view (filters/sort/columns)
    -- 'config'= a singleton-ish app setting keyed by `name`
    kind        TEXT        NOT NULL DEFAULT 'view',
    -- Owner identity ('*' = shared / system-wide).
    owner       TEXT        NOT NULL DEFAULT '*',
    -- Human/programmatic key, unique within (kind, owner).
    name        TEXT        NOT NULL,
    -- The console area this view targets ('deployments','pods','logs',...).
    -- NULL for plain config rows.
    resource    TEXT,
    -- Arbitrary structured payload: query params, column set, settings, etc.
    payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saved_views_kind_owner_name_uniq UNIQUE (kind, owner, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_owner ON saved_views (owner, kind);
CREATE INDEX IF NOT EXISTS idx_saved_views_resource ON saved_views (resource);

-- Keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION saved_views_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_saved_views_updated_at ON saved_views;
CREATE TRIGGER trg_saved_views_updated_at
    BEFORE UPDATE ON saved_views
    FOR EACH ROW EXECUTE FUNCTION saved_views_touch_updated_at();

-- ------------------------------------------------------------------ --
-- Seed                                                                --
-- ------------------------------------------------------------------ --
-- A couple of cluster-agnostic config rows. No namespace-specific saved
-- views are seeded — operators create their own once they know which
-- namespaces they manage.
-- Idempotent: ON CONFLICT DO NOTHING against the (kind, owner, name) unique key.
INSERT INTO saved_views (kind, owner, name, resource, payload) VALUES
    ('view', '*', 'Recent builds', 'builds',
        '{"limit":25}'::jsonb),
    ('config', '*', 'log.tail.default', NULL,
        '{"lines":200}'::jsonb),
    ('config', '*', 'audit.page.size', NULL,
        '{"limit":50}'::jsonb)
ON CONFLICT (kind, owner, name) DO NOTHING;

-- A starter audit row so the feed is never empty on a fresh install.
INSERT INTO audit_log (actor, action, target_ns, target_kind, target_name, detail)
SELECT 'system', 'login', NULL, NULL, NULL,
       '{"note":"console initialized"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM audit_log);
