# inInfra deploy manifests

Kubernetes manifests for installing the **inInfra Console** — a Rust/axum API
(`ininfra-api`) plus a Next.js web UI (`ininfra-web`), backed by Postgres. The
console reads and manages workloads (deployments, pods, configmaps, secrets,
HPAs, nodes, …) across a configurable set of namespaces.

These files under `k8s/` are **templates**. Every value you need to change is
marked with a `# REPLACE:` comment. Search for `REPLACE` before applying.

## Components

| File | What it creates |
| --- | --- |
| `k8s/00-namespace.yaml` | The `ininfra` install namespace. |
| `k8s/10-rbac.yaml` | ServiceAccount + ClusterRoles/ClusterRoleBinding for the API, plus an example per-namespace RoleBinding. |
| `k8s/20-postgres.yaml` | Single-replica Postgres StatefulSet + Service + credentials Secret. |
| `k8s/30-api.yaml` | The API Deployment + Service + `DATABASE_URL` Secret, with all runtime config. |
| `k8s/40-web.yaml` | The web Deployment + Service. |
| `k8s/50-ingress.yaml` | An Ingress exposing the console (AWS ALB example). |

The container images are built with `Dockerfile.api` and `Dockerfile.web`
(build context = the `devops-console/` repo root).

## Placeholders to replace

- **Image registry** — `your-registry.example.com/ininfra-{api,web}:latest` in
  `30-api.yaml` and `40-web.yaml`. Point these at the registry you push to.
- **Hostname** — `ininfra.example.com` in `50-ingress.yaml`.
- **TLS certificate** — the `certificate-arn` / TLS reference in `50-ingress.yaml`.
- **Install namespace** — `ininfra` (and the `ininfra-*` SA/Secret/Service
  names) if you want to install elsewhere. They are internally consistent;
  change them everywhere together.
- **`MANAGED_NAMESPACES`** (and **`CICD_NAMESPACE`**) in `30-api.yaml` — the
  comma-separated namespaces the console manages. Default is `default`.
- **`CLUSTER_NAME` / `PRODUCT_NAME` / `BUILD_CATALOG_CONFIGMAP`** in
  `30-api.yaml` — cosmetic / config labels.
- **Secrets** — create these out of band (or via sealed-secrets /
  external-secrets) with your own values:
  - `ininfra-postgres` (in `20-postgres.yaml`) — DB name/user/password.
  - `ininfra-api-db` (in `30-api.yaml`) — `DATABASE_URL`; the password must
    match the one in `ininfra-postgres`.
  - `ininfra-auth` — `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
  - `ininfra-aws` (optional) — `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
    `AWS_REGION`. Enables ECR features; omit it to disable them.
- **Ingress controller** — `50-ingress.yaml` uses the AWS Load Balancer
  Controller (ALB). For nginx/traefik/etc. set `ingressClassName` and swap the
  `alb.ingress.kubernetes.io/*` annotations for your controller's equivalents.
- **Storage class** — `20-postgres.yaml` uses `gp3` (AWS EBS); change it to a
  class your cluster provides.

## RoleBinding per managed namespace

`10-rbac.yaml` defines the namespaced permissions as a **ClusterRole**
(`ininfra-api-ns`) but only ships ONE example **RoleBinding** (in `default`).
The API can only act in a namespace where that ClusterRole is bound. So:

> Create one RoleBinding of `ininfra-api-ns` (subject = the `ininfra-api`
> ServiceAccount in the `ininfra` namespace) in **each** namespace you list in
> `MANAGED_NAMESPACES` and in `CICD_NAMESPACE`.

Copy the example RoleBinding, change `metadata.namespace`, and apply once per
managed namespace.

## Apply order

Apply in numeric order so dependencies (namespace, RBAC, DB) exist first:

```sh
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/10-rbac.yaml
kubectl apply -f k8s/20-postgres.yaml
kubectl apply -f k8s/30-api.yaml
kubectl apply -f k8s/40-web.yaml
kubectl apply -f k8s/50-ingress.yaml
```

Then create the per-managed-namespace RoleBindings described above.
