# Contributing to inInfra

Thanks for your interest in improving inInfra — the self-hostable,
OpenShift-style web console for operating Kubernetes clusters. This guide covers
how to set up a development environment, the one rule that matters most (the
cross-artifact contract), and the checks every change must pass before it can be
merged.

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md). All changes — including from maintainers —
go through pull requests; nothing is pushed directly to `master`.

---

## Repository layout

```
apps/web              Next.js 15 (App Router, TypeScript, Tailwind) — the UI
apps/api              Rust (axum + kube-rs + sqlx) — the cluster/API backend
packages/shared-types The canonical DTO contract (TypeScript)
db/migrations         sqlx migrations, embedded and run at API startup
deploy                Dockerfiles + example Kubernetes manifests
docs                  INSTALL.md, CONFIGURATION.md
```

It is a pnpm + Turborepo monorepo for the JS side; the Rust API is a standalone
Cargo crate under `apps/api`.

---

## Prerequisites

- **Node 20** and **pnpm 9** (the repo pins `pnpm@9.12.0` via `packageManager`).
  Install pnpm with `corepack enable` or from <https://pnpm.io>.
- **Rust 1.91+** with `rustfmt` and `clippy` components
  (`rustup component add rustfmt clippy`).
- **Postgres 14+** for the audit log and saved config.
- A **Kubernetes context** to point the API at (any cluster, or a local
  kind/minikube/k3d). The API uses your current kube context when run locally.
- Optional: a **Jenkins** instance (builds/deploys features) and **AWS ECR**
  credentials (image inventory / commit resolution). Both features are
  gracefully disabled when their config is absent.

---

## First-time setup

```bash
# 1. Install JS dependencies for the whole workspace
pnpm install

# 2. Configure local environment
cp .env.example .env
#    Edit .env: set DATABASE_URL, a >=32-byte SESSION_SECRET
#    (openssl rand -hex 32), ADMIN_USERNAME/ADMIN_PASSWORD, and
#    MANAGED_NAMESPACES for the namespaces you want the console to operate on.

# 3. Start Postgres (any 14+ instance). A throwaway local one:
docker run --rm -d --name ininfra-pg \
  -e POSTGRES_USER=ininfra -e POSTGRES_PASSWORD=ininfra -e POSTGRES_DB=ininfra \
  -p 5432:5432 postgres:16

# Migrations run automatically when the API boots — no manual step needed.
# (If you want to run them by hand: `pnpm migrate`, which needs the sqlx CLI.)
```

---

## Running locally

You can run both apps at once from the repo root, or each separately.

```bash
# Everything (web + api) via Turborepo:
pnpm dev

# …or run them in separate terminals:
pnpm dev:api      # cargo run --manifest-path apps/api/Cargo.toml  → :8080
pnpm dev:web      # next dev                                        → :3000
```

Open <http://localhost:3000> and log in with the `ADMIN_USERNAME` /
`ADMIN_PASSWORD` from your `.env`. The browser calls same-origin `/api/*`, which
the Next.js rewrite proxies to the Rust API at `API_INTERNAL_URL`
(defaults to `http://localhost:8080` in dev).

---

## The cross-artifact contract (read this)

inInfra's API surface is defined in **three files that must stay in lock-step**.
The wire format is the single source of truth; a change to one of these is almost
never correct on its own:

| File | Role |
|------|------|
| `packages/shared-types/src/index.ts` | Canonical DTO shapes (camelCase JSON). The source of truth for the wire format. |
| `apps/web/lib/api.ts` | The typed fetch client. Every endpoint has a one-to-one method here, typed against `@ininfra/shared-types`. |
| `apps/api/src/routes/mod.rs` | The authoritative list of server paths. The Rust serde structs must serialize to exactly the shapes in `shared-types`. |

Rules:

- **Never change a path or a shape in one file without updating the other two**
  (and the endpoint contract comment block at the top of
  `apps/api/src/routes/mod.rs`).
- **JSON is always camelCase on the wire.** Rust structs use serde rename to
  match; do not introduce snake_case field names in DTOs.
- Timestamps are RFC3339/ISO-8601 UTC strings. Kubernetes quantities (`500m`,
  `1Gi`) are strings. Optional fields are `T | null` (serde `Option<T>`), never
  omitted.

If your PR adds or changes an endpoint, the reviewer will check all three
artifacts agree. The PR template has a checkbox for exactly this.

---

## Required checks before opening a PR

Run all of these locally and make sure they pass. CI runs the same gate on every
pull request, and a PR cannot merge until it is green.

**Web / shared-types (from the repo root):**

```bash
pnpm lint        # turbo run lint  (next lint across the workspace)
pnpm typecheck   # turbo run typecheck  (tsc --noEmit; shared-types + web)
pnpm build       # turbo run build  (next build — must compile cleanly)
```

**API (Rust):**

```bash
cargo fmt --manifest-path apps/api/Cargo.toml --check
cargo clippy --manifest-path apps/api/Cargo.toml -- -D warnings
cargo build --manifest-path apps/api/Cargo.toml
```

If you touched DTOs, also confirm `pnpm typecheck` passes in both
`packages/shared-types` and `apps/web` — a divergent contract usually surfaces
there first.

> Note: `cargo clippy -- -D warnings` treats all lints as errors. If you hit a
> pre-existing warning unrelated to your change, mention it in the PR rather than
> suppressing it silently.

---

## Branch & PR conventions

- **All changes go through pull requests.** No direct pushes to `master`.
- Branch off the latest `master`. Name branches by intent, e.g.
  `feat/pvc-file-rename`, `fix/log-stream-reconnect`, `docs/install-rbac`,
  `chore/bump-axum`.
- Keep PRs focused; one logical change per PR makes review (and the contract
  check) tractable.
- Write [Conventional Commits](https://www.conventionalcommits.org/)-style
  messages where practical (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- Reference the issue you are closing in the PR description with `Closes #123`.
- Fill in the PR template, including the contract lock-step and check gate
  checkboxes.
- Update `CHANGELOG.md` under `## [Unreleased]` for user-facing changes.

---

## Reporting bugs & requesting features

Use the GitHub issue forms (Bug report / Feature request). For the bug form,
please include the inInfra version/commit, your Kubernetes version and distro,
and whether you run the console in-cluster or locally — it makes triage far
faster.

Security issues should **not** be filed as public issues — see
[SECURITY.md](SECURITY.md).
