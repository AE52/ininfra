-- 0011_settings.sql
-- First-run setup wizard backing store. A singleton `app_settings` row holds
-- the wizard-chosen, runtime-mutable configuration (product/cluster name, the
-- managed-namespace allowlist, CI/CD namespace, feature toggles) as a JSONB
-- blob plus a `setup_complete` flag. The env-derived `Config` remains the
-- source for infra (DATABASE_URL, SESSION_SECRET, ...) and the defaults that
-- seed every field; the DB JSONB only overlays values chosen in the wizard.
-- See `settings.rs` and `routes/setup.rs`.
CREATE TABLE IF NOT EXISTS app_settings (
    -- Singleton: exactly one row, always id = 1.
    id             SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    setup_complete BOOLEAN     NOT NULL DEFAULT false,
    settings       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the singleton row so reads/updates never have to handle "no row".
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
