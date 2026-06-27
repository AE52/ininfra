-- 0002_users.sql
-- Console authentication: a single `users` table backing username/password
-- login. Passwords are stored ONLY as argon2id PHC-string hashes (never
-- plaintext). The bootstrap admin is upserted on API startup from the
-- ADMIN_USERNAME / ADMIN_PASSWORD env (sourced from a k8s Secret) — see
-- `main.rs`. There is no self-service signup; accounts are provisioned
-- operator-side.
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT        NOT NULL UNIQUE,
    -- argon2id PHC string, e.g. "$argon2id$v=19$m=19456,t=2,p=1$...".
    password_hash TEXT        NOT NULL,
    -- Coarse role; 'admin' = full access. Room to add 'viewer' etc. later.
    role          TEXT        NOT NULL DEFAULT 'admin',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login    TIMESTAMPTZ
);

-- Case-insensitive username lookups for login.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));
