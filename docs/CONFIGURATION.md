# Configuration

All deployment-specific behavior is set through environment variables — nothing
about a cluster, namespace, registry, or brand is hard-coded. This page is the
complete reference. There are two components: the **API** (Rust/axum) and the
**web** (Next.js).

## API

The API reads its configuration once at startup.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | Postgres connection string for the audit log and saved config, e.g. `postgres://user:pass@host:5432/ininfra`. The API exits at startup if unset. Migrations run automatically on boot. |
| `SESSION_SECRET` | Yes | — | Signing key for the HS256 session JWTs. Must be at least 32 random bytes; the API refuses to boot if it is too short. Rotating this value invalidates every outstanding session. |
| `ADMIN_USERNAME` | Bootstrap | — | Username of the bootstrap admin account. Set together with `ADMIN_PASSWORD`. On each startup the admin is upserted (idempotent), so changing the password and restarting rotates it. If neither is set, admin bootstrap is skipped (useful with a pre-seeded database). |
| `ADMIN_PASSWORD` | Bootstrap | — | Plaintext password for the bootstrap admin. Hashed with argon2id at startup; never stored or logged in plaintext. Set together with `ADMIN_USERNAME`. |
| `MANAGED_NAMESPACES` | No | `default` | Comma-separated list of namespaces the console may read and operate on. The mutating handlers validate the target namespace against this allowlist. RBAC must grant access in each of these namespaces (see INSTALL.md). |
| `CLUSTER_NAME` | No | `kubernetes` | Human-friendly cluster name shown in the masthead and login screen. |
| `PRODUCT_NAME` | No | `inInfra` | Brand/product name shown in the UI. |
| `BUILD_CATALOG_CONFIGMAP` | No | `ininfra-build-catalog` | Name of the ConfigMap that holds the build catalog (the list of buildable services) for the Builds feature. Optional. |
| `CICD_NAMESPACE` | No | first entry of `MANAGED_NAMESPACES` | Namespace where CI (Jenkins) lives; used for build audit attribution. |
| `JENKINS_BASE_URL` | No | — | Base URL of the Jenkins server used to trigger and track builds. When unset/blank, the builds feature is reported as unavailable to the UI. |
| `JENKINS_USER` | No | — | Jenkins username for authenticated build triggering. |
| `JENKINS_API_TOKEN` | No | — | Jenkins API token paired with `JENKINS_USER`. |
| `AWS_ACCESS_KEY_ID` | No | — | When present, enables the ECR features: image inventory, image deletion, and digest→commit resolution for the deploy view. When absent, those features degrade gracefully (the deploy view stays Kubernetes-only). |
| `AWS_SECRET_ACCESS_KEY` | No | — | Paired with `AWS_ACCESS_KEY_ID`. |
| `AWS_REGION` | No | — | AWS region for the ECR client. Falls back to `AWS_DEFAULT_REGION` if set. |
| `SPOT_LABEL_KEY` | No | — (empty = disabled) | Node label key used to flag spot/preemptible nodes. Standard cloud labels (EKS `eks.amazonaws.com/capacityType`, Karpenter `karpenter.sh/capacity-type`) are always detected; set this only to additionally recognize your own lifecycle label. |
| `SPOT_LABEL_VALUE` | No | — (empty = any value) | Value the `SPOT_LABEL_KEY` label must equal for a node to count as spot. Leave empty to treat the mere presence of the label (any value) as spot. Ignored when `SPOT_LABEL_KEY` is unset. |
| `SPOT_TAINT_KEY` | No | — (empty = disabled) | Node taint key used to flag spot/preemptible nodes (any value/effect). Set this when your spot nodes are marked with a dedicated taint instead of (or in addition to) a label. |
| `BIND_ADDR` | No | `0.0.0.0:8080` | Socket address the API listens on. Must be a valid `host:port`. |

### Notes

- **Feature flags are derived, not configured.** The UI learns whether Jenkins
  and ECR are available from `GET /api/config`, which reflects whether
  `JENKINS_BASE_URL` and the AWS credentials are set. You enable a feature by
  configuring its dependency, not by flipping a separate switch.
- **`CICD_NAMESPACE` defaults to the first managed namespace.** If you list
  `prod,staging,cicd` in `MANAGED_NAMESPACES` and want CI attributed to `cicd`,
  set `CICD_NAMESPACE=cicd` explicitly.

## Web

The web server (Next.js standalone) needs only two variables.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_INTERNAL_URL` | Yes | — | In-cluster URL of the API, e.g. `http://ininfra-api.your-namespace.svc:8080`. The Next.js rewrite proxies browser `/api/*` calls to this address at runtime, and server-side rendering reads it. Do not bake it in at build time. |
| `PORT` | No | `3000` | Port the web server listens on. |

In local development, `API_INTERNAL_URL` defaults to `http://localhost:8080` if
unset, matching the API's default `BIND_ADDR`.
