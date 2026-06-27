-- Migrate legacy viewer role to developer
UPDATE users SET role = 'developer' WHERE role = 'viewer';

-- Per-role permission overrides (only non-default values stored here)
CREATE TABLE IF NOT EXISTS role_permissions (
  role            TEXT        NOT NULL,
  permission_key  TEXT        NOT NULL,
  allowed         BOOLEAN     NOT NULL,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_key)
);
