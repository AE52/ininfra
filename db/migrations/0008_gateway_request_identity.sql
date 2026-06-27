-- Identity columns for the sampled gateway feed: the gateway already decodes
-- the JWT into x-user-id / x-role-id / x-is-admin request headers (see the
-- APISIX jwt-header-conf plugin_config), so we capture the resolved identity —
-- never the token itself.
ALTER TABLE gateway_requests ADD COLUMN IF NOT EXISTS x_user_id text;
ALTER TABLE gateway_requests ADD COLUMN IF NOT EXISTS x_role_id text;
ALTER TABLE gateway_requests ADD COLUMN IF NOT EXISTS is_admin boolean;

CREATE INDEX IF NOT EXISTS gateway_requests_x_user_id_idx ON gateway_requests (x_user_id);
