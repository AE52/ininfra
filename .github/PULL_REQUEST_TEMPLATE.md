<!--
Thanks for contributing to inInfra! Please fill out this template.
All changes go through PRs — nothing is pushed directly to master.
-->

## Summary

<!-- What does this PR do and why? -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] Build / CI / chore

## Contract lock-step

The API surface lives in three artifacts that **must stay in sync**. Check the
relevant boxes (or mark N/A if no endpoint/DTO changed).

- [ ] N/A — this PR does not add or change any API endpoint or DTO.
- [ ] `packages/shared-types/src/index.ts` updated (DTO shapes, camelCase JSON).
- [ ] `apps/web/lib/api.ts` updated (typed client method, one-to-one with the route).
- [ ] `apps/api/src/routes/mod.rs` updated (server path **and** the endpoint contract comment block).
- [ ] Rust serde structs serialize to exactly the `shared-types` shapes (camelCase; `Option<T>` → `T | null`).

## Checks (CI gate — run locally first)

**Web / shared-types:**

- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` passes

**API (Rust):**

- [ ] `cargo fmt --manifest-path apps/api/Cargo.toml --check` passes
- [ ] `cargo clippy --manifest-path apps/api/Cargo.toml -- -D warnings` passes
- [ ] `cargo build --manifest-path apps/api/Cargo.toml` passes

## Other

- [ ] Added a DB migration under `db/migrations/` (if the schema changed) and it runs at startup.
- [ ] Updated `CHANGELOG.md` under `## [Unreleased]` for user-facing changes.
- [ ] Updated docs (`README.md`, `docs/INSTALL.md`, `docs/CONFIGURATION.md`) if behavior or config changed.

## Screenshots / notes

<!-- UI changes: before/after screenshots. Anything reviewers should know. -->
