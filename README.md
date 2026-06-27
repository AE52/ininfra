# inInfra

A self-hostable, OpenShift-style web console for operating any Kubernetes cluster.

inInfra gives you one place to run a cluster: view, scale, and restart
workloads; edit environment from ConfigMaps and Secrets; browse files inside
PersistentVolumeClaims; trigger Jenkins builds and see (and roll back) the
commit that is actually deployed; manage console users with roles; read an
audit log of every change; watch a Sentry-style error feed; and publish an
Atlassian-style status page. It was extracted from an internal tool and is now
generic — point it at your own cluster and registry and run it.

## What it is

inInfra is a thin operations console, not a cluster installer or a GitOps
engine. It connects to a Kubernetes cluster through a ServiceAccount (in-cluster)
or your kube context (locally), reads and patches a configurable set of
**managed namespaces**, and records every mutation to Postgres for auditing.
Nothing about a particular cluster, namespace, registry, or brand is hard-coded —
it is all configuration (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md)).

## Features

- **Workloads** — list Deployments and StatefulSets, view detail, scale, and
  restart (rolling) across the managed namespaces.
- **Environment editing** — view and patch container env sourced from
  ConfigMaps and Secrets, with secret values masked unless explicitly revealed
  and optimistic concurrency via `resourceVersion`.
- **Pods & logs** — list pods, delete (restart) a pod, view a log snapshot, and
  stream logs live over Server-Sent Events.
- **Storage / PVC file browser** — browse, read, write, and delete files inside
  a PersistentVolumeClaim by exec-ing into the pod that mounts it.
- **Builds & deploys (Jenkins)** — trigger and track Jenkins builds, see recent
  build history, resolve the git commit currently deployed (via image tags /
  optional ECR), and roll back to a previous image.
- **Autoscaling** — view and edit HorizontalPodAutoscalers.
- **Nodes** — cluster-wide node inventory with live CPU/memory usage and the
  pods scheduled on each; cordon / uncordon a node (admin, audited).
- **Jobs & CronJobs** — list CronJobs and recent Jobs; suspend/resume a CronJob
  and trigger a run on demand (audited).
- **Manifest (YAML)** — view the live object exactly as the API server has it,
  with managed fields and the last-applied annotation stripped, copy to clipboard.
- **Describe & events** — per-object conditions, container status, and the
  resource's recent Kubernetes events, right on the detail page.
- **Drift** — see how a workload's live spec differs from its last-applied
  configuration (image, replicas, resource requests/limits).
- **Topology & disruption budget** — where a workload's replicas run across
  nodes and zones (single-node/zone SPOF flags) and its PodDisruptionBudget.
- **Capacity & quotas** — per-node allocatable vs requested vs used with cluster
  headroom, plus per-namespace ResourceQuota / LimitRange usage.
- **Right-sizing** — configured requests/limits next to live usage with
  over/under-provisioned recommendations (advisory, read-only).
- **Secrets health** — TLS certificate expiry scanner (days remaining, never
  reveals secret values).
- **kubectl helper** — copy the equivalent kubectl commands for any workload or pod.
- **Services & ingresses** — see how workloads are exposed.
- **Users & roles** — create console users with `developer`, `admin`, or
  `super_admin` roles; per-endpoint RBAC enforced on the API.
- **Audit log** — cursor-paginated, time-ordered record of every mutating
  action, attributed to the acting user (admin-only).
- **Error feed** — a Sentry-style feed of captured client and API errors.
- **Status page** — an Atlassian-style status page backed by a background health
  monitor that records component health transitions.

## Architecture

```
                         your-console-host
                                │
                          Ingress / LB
                                │
            ┌───────────────────┴────────────────────┐
       /healthz, /api                          /  (everything else)
            │                                        │
      ┌─────▼─────┐                            ┌─────▼─────┐
      │    api    │  Rust (axum + kube-rs +    │    web    │  Next.js 15
      │  :8080    │  sqlx). ServiceAccount     │  :3000    │  App Router + TS
      └─────┬─────┘  with RBAC across the      └─────┬─────┘  + Tailwind
            │        managed namespaces.             │
     ┌──────┼──────────┐                     browser /api/* proxied
     │      │          │                     to the api via Next rewrite
  kube-rs  sqlx     reqwest                  (API_INTERNAL_URL)
     │      │          │
  Kube API Postgres  Jenkins (optional)   ── plus optional AWS ECR (image
  (your    (audit +                          inventory / delete / commit
  cluster) saved cfg)                        resolution)
```

- **apps/web** — Next.js 15 (App Router, TypeScript, Tailwind), standalone
  output. The browser calls same-origin `/api/*`, which a Next rewrite proxies
  to the Rust API at `API_INTERNAL_URL`.
- **apps/api** — Rust: `axum` HTTP, `kube-rs` + `k8s-openapi` for cluster ops,
  `sqlx`/Postgres for the audit log and saved config, `reqwest` for Jenkins, and
  an optional AWS SDK client for ECR.
- **packages/shared-types** — the canonical DTO contract (TypeScript). Rust
  serde structs serialize to these exact camelCase shapes.
- **db/migrations** — sqlx migrations, embedded and run at API startup.
- **deploy** — Dockerfiles and Kubernetes manifests (namespace, RBAC, Postgres,
  api/web Deployments and Services, Ingress).

## Prerequisites

- A **Kubernetes cluster** and either a kube context (local) or an in-cluster
  ServiceAccount (deployed). RBAC requirements are in
  [docs/INSTALL.md](docs/INSTALL.md).
- **Postgres 14+** for the audit log and saved config.
- To build from source: **Node 20** + **pnpm 9** (web) and **Rust 1.91+** (api).
- **Optional Jenkins** — enables the builds/deploys features.
- **Optional AWS ECR** — enables image inventory, deletion, and digest→commit
  resolution.

## Quick start

```bash
# 1. Build images (build context is the repo root)
docker build -f deploy/Dockerfile.api -t your-registry/ininfra-api:latest .
docker build -f deploy/Dockerfile.web -t your-registry/ininfra-web:latest .
docker push your-registry/ininfra-api:latest
docker push your-registry/ininfra-web:latest

# 2. Configure secrets, RBAC, and the manifests for your cluster
#    (namespace, MANAGED_NAMESPACES, image refs, ingress host)

# 3. Deploy
kubectl apply -f deploy/k8s/
```

For the full, step-by-step install — secrets, the per-namespace RoleBindings,
Ingress, and first login — see **[docs/INSTALL.md](docs/INSTALL.md)**.

To run locally for development, copy `.env.example` to `.env`, point it at a
Postgres and your kube context, then `pnpm install && pnpm dev`.

## Configuration

Everything deployment-specific is an environment variable. Summary below; the
complete reference is in **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**.

| Variable | Component | Required | Default | Purpose |
|----------|-----------|----------|---------|---------|
| `DATABASE_URL` | api | yes | — | Postgres connection string |
| `SESSION_SECRET` | api | yes | — | Session JWT signing key (>=32 bytes) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | api | bootstrap | — | First admin user |
| `MANAGED_NAMESPACES` | api | no | `default` | CSV of namespaces the console operates on |
| `CLUSTER_NAME` | api | no | `kubernetes` | Cluster name shown in the UI |
| `PRODUCT_NAME` | api | no | `inInfra` | Brand name shown in the UI |
| `BUILD_CATALOG_CONFIGMAP` | api | no | `ininfra-build-catalog` | ConfigMap holding the build catalog |
| `CICD_NAMESPACE` | api | no | first managed ns | Namespace where CI/CD lives |
| `JENKINS_BASE_URL` / `JENKINS_USER` / `JENKINS_API_TOKEN` | api | no | — | Jenkins integration |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | api | no | — | Enables ECR features |
| `BIND_ADDR` | api | no | `0.0.0.0:8080` | API listen address |
| `API_INTERNAL_URL` | web | yes | — | In-cluster URL of the api |
| `PORT` | web | no | `3000` | Web listen port |

## CI/CD

An example GitHub Actions workflow is included at
`.github/workflows/deploy.yml`. It builds and pushes the api and web images and
rolls them out with `kubectl set image`. Adapt the `env` block (registry,
cluster, IAM role / credentials, namespace) to your own infrastructure — as
written it targets a specific registry and EKS cluster.

## Security

- **Password hashing** — admin and user passwords are hashed with **argon2id**;
  plaintext is never stored or logged.
- **Sessions** — login mints a stateless **HS256 JWT** held in an `HttpOnly`,
  `Secure`, `SameSite=Lax` cookie (12h TTL). Rotating `SESSION_SECRET`
  invalidates every outstanding token. `SESSION_SECRET` must be >=32 random
  bytes; the API refuses to boot with a too-short key.
- **Namespace allowlist** — the API only reads and patches the configured
  `MANAGED_NAMESPACES`; mutating handlers validate the target namespace.
- **Roles** — `viewer` accounts may read only; any mutating request
  (POST/PUT/PATCH/DELETE) is rejected for non-admins. User management is
  admin-only.
- **Least-privilege RBAC** — the API ServiceAccount is granted namespaced
  read/patch verbs only in the managed namespaces (plus the few extra verbs the
  mutating handlers need), and read-only cluster-scoped access to nodes,
  namespaces, and pods. See [docs/INSTALL.md](docs/INSTALL.md).

Always serve the console over TLS so the `Secure` session cookie is honored.

## Contributing

Contributions are welcome. The three contract artifacts —
`packages/shared-types/src/index.ts` (DTO shapes), `apps/web/lib/api.ts` (typed
client), and `apps/api/src/routes/mod.rs` (server paths) — must stay in
lock-step; keep JSON camelCase. Run `pnpm lint`, `pnpm typecheck`, and
`cargo build` before opening a PR. Please file issues for bugs and feature
requests.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
