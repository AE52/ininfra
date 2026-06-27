# Changelog

All notable changes to inInfra are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- _Nothing yet._

### Changed
- _Nothing yet._

### Fixed
- _Nothing yet._

## [0.1.0] - 2026-06-27

Initial public release of inInfra — a self-hostable, OpenShift-style web console
for operating any Kubernetes cluster. Extracted from an internal tool and made
generic: point it at your own cluster and registry via configuration (no
cluster, namespace, registry, or brand is hard-coded).

### Added

- **Workloads** — list Deployments and StatefulSets, view detail, scale, and
  rolling-restart across the managed namespaces.
- **Environment editing** — view and patch container env sourced from ConfigMaps
  and Secrets, with secret values masked unless explicitly revealed and
  optimistic concurrency via `resourceVersion`.
- **Pods & logs** — list pods, delete (restart) a pod, view a log snapshot,
  stream logs live over Server-Sent Events, and a multi-pod log view with
  regex / time-range / since filters.
- **Storage / PVC file browser** — browse, read, write, and delete files inside a
  PersistentVolumeClaim by exec-ing into the pod that mounts it.
- **Builds & deploys (Jenkins, optional)** — trigger and track Jenkins builds,
  see recent build history, resolve the git commit currently deployed via image
  tags / optional ECR, and roll back to a previous image.
- **Autoscaling** — view and edit HorizontalPodAutoscalers.
- **Nodes** — cluster-wide node inventory and the pods scheduled on each,
  including spot / on-demand classification.
- **Services & ingresses** — see how workloads are exposed.
- **Users & roles** — create console users with `admin` or `viewer` roles
  (admin-managed).
- **Audit log** — cursor-paginated, time-ordered record of every mutating
  action, attributed to the acting user.
- **Error feed** — a Sentry-style feed of captured client and API errors.
- **Status page** — an Atlassian-style status page backed by a background health
  monitor that records component health transitions.
- **Security** — argon2id password hashing; stateless HS256 session JWT in an
  `HttpOnly` / `Secure` / `SameSite=Lax` cookie; namespace allowlist enforced on
  all mutating handlers; least-privilege RBAC for the API ServiceAccount.
- **Deploy** — distroless static API image and Next.js standalone web image,
  with example Kubernetes manifests (namespace, RBAC, Postgres, Deployments,
  Services, Ingress) and an example GitHub Actions deploy workflow.

[Unreleased]: https://github.com/AE52/ininfra/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AE52/ininfra/releases/tag/v0.1.0
