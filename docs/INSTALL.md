# Install

This guide deploys inInfra to your own Kubernetes cluster. Replace every
placeholder (`your-registry`, `your-cluster`, `your-namespace`, the namespaces
in `MANAGED_NAMESPACES`, hostnames, and passwords) with your own values.

The `deploy/k8s/` manifests are a working example. They were written for a
specific cluster, so you must edit the namespace, image references, RBAC
bindings, and Ingress before applying them.

## 1. Build and push the images

The build context is the **repo root** (the directory containing `apps/` and
`deploy/`).

```bash
docker build -f deploy/Dockerfile.api -t your-registry/ininfra-api:latest .
docker build -f deploy/Dockerfile.web -t your-registry/ininfra-web:latest .

docker push your-registry/ininfra-api:latest
docker push your-registry/ininfra-web:latest
```

The API image is a static musl binary on distroless (rootless); the web image
is the Next.js standalone output on `node:20-alpine`.

## 2. Create the namespace

This is the namespace the console itself runs in (distinct from the namespaces
it manages).

```bash
kubectl create namespace your-namespace
```

## 3. Create Postgres and the secrets

### Postgres

Run a Postgres 14+ reachable from the API. You can use the example StatefulSet
in `deploy/k8s/20-postgres.yaml` (edit the credentials first) or a managed
database. Note the connection string for the next step.

### Secrets

Create a database-URL secret, an auth secret, and (optionally) Jenkins and AWS
secrets. Use real, random values — especially `SESSION_SECRET` (>=32 bytes) and
the admin password.

```bash
# Database URL
kubectl -n your-namespace create secret generic ininfra-db \
  --from-literal=DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/ininfra'

# Auth: session signing key + bootstrap admin
kubectl -n your-namespace create secret generic ininfra-auth \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=ADMIN_USERNAME='admin' \
  --from-literal=ADMIN_PASSWORD='choose-a-strong-password'

# Optional: Jenkins integration (enables builds/deploys)
kubectl -n your-namespace create secret generic ininfra-jenkins \
  --from-literal=JENKINS_BASE_URL='http://jenkins.your-cicd-namespace.svc:8080' \
  --from-literal=JENKINS_USER='your-jenkins-user' \
  --from-literal=JENKINS_API_TOKEN='your-jenkins-token'

# Optional: AWS creds (enables ECR image inventory / delete / commit resolution)
kubectl -n your-namespace create secret generic ininfra-aws \
  --from-literal=AWS_ACCESS_KEY_ID='AKIA...' \
  --from-literal=AWS_SECRET_ACCESS_KEY='...' \
  --from-literal=AWS_REGION='your-region'
```

Wire these into the API Deployment with `secretKeyRef` env entries. See
`deploy/k8s/30-api.yaml` for the pattern, and adjust the secret names to match
the ones you created. Set the non-secret config (`MANAGED_NAMESPACES`,
`CLUSTER_NAME`, `PRODUCT_NAME`, etc. — see
[CONFIGURATION.md](CONFIGURATION.md)) as plain env values.

## 4. RBAC

The API authenticates to the cluster as its ServiceAccount. It needs two tiers
of permissions.

### Namespaced — granted in EACH managed namespace

Define a `ClusterRole` with the verbs below, then create a **`RoleBinding` per
managed namespace** binding it to the API ServiceAccount. A `ClusterRole` may be
referenced by a `RoleBinding` to scope it to a single namespace, so one role
definition can be bound into every managed namespace.

| API group | Resources | Verbs |
|-----------|-----------|-------|
| `""` (core) | `deployments`* | (see `apps`) |
| `""` | `configmaps`, `secrets`, `pods`, `services` | `get`, `list`, `watch`, `patch` |
| `""` | `ingresses`** | — |
| `""` | `events` | `get`, `list`, `watch` |
| `""` | `pods/log` | `get` (`list`, `watch` for streaming) |
| `""` | `pods` | `delete` (restart deletes the pod) |
| `""` | `pods/exec` | `get`, `create` (PVC file browser execs into the pod) |
| `""` | `persistentvolumeclaims` | `get`, `list`, `watch` |
| `apps` | `deployments`, `statefulsets` | `get`, `list`, `watch`, `patch` |
| `apps` | `deployments/scale`, `statefulsets/scale` | `get`, `patch` |
| `autoscaling` | `horizontalpodautoscalers` | `get`, `list`, `watch`, `patch` |
| `networking.k8s.io` | `ingresses` | `get`, `list`, `watch`, `patch` |

\* `deployments` live in the `apps` group (row below); listed here for clarity.
\*\* `ingresses` live in `networking.k8s.io` (row below).

> Important: there must be one `RoleBinding` per managed namespace. If you add a
> namespace to `MANAGED_NAMESPACES` later, add a matching `RoleBinding` or the
> API will get 403s for that namespace.

### Cluster-scoped — read-only

Bind a `ClusterRole` with these verbs via a `ClusterRoleBinding`:

| API group | Resources | Verbs |
|-----------|-----------|-------|
| `""` | `nodes` | `get`, `list`, `watch` |
| `""` | `pods`, `namespaces` | `get`, `list`, `watch` |
| `metrics.k8s.io` | `nodes`, `pods` | `get`, `list` (optional, for metrics) |

All mutating verbs stay scoped to the managed namespaces; cluster-scoped access
is read-only.

`deploy/k8s/10-rbac.yaml` is a complete worked example of all of the above for
three namespaces — copy it, rename the namespaces to your own, and add or remove
`RoleBinding` blocks to match `MANAGED_NAMESPACES`.

## 5. Apply the manifests and set up Ingress

After editing the placeholders (namespace, image references, secret names, env,
and the managed-namespace `RoleBinding`s):

```bash
kubectl apply -f deploy/k8s/
```

This creates the Postgres, the API and web Deployments and Services, and the
Ingress. Edit `deploy/k8s/50-ingress.yaml` for your ingress controller and
hostname — the example uses an AWS ALB Ingress, but any controller works.
Route `/healthz` and `/api` to the API Service (port 8080) and everything else
to the web Service (port 3000). Serve over **TLS** so the `Secure` session
cookie is honored.

Verify the rollout:

```bash
kubectl -n your-namespace get pods
kubectl -n your-namespace logs deploy/ininfra-api
```

## 6. First login

Open the console host in a browser and log in with the `ADMIN_USERNAME` /
`ADMIN_PASSWORD` you set in the auth secret. From there, create additional users
(admin or viewer) under **Administration → Users**.

To rotate the admin password later, update the auth secret and restart the API
Deployment — the admin is re-upserted on startup.
