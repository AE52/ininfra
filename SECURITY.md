# Security Policy

inInfra is an operations console that holds privileged access to a Kubernetes
cluster: it can scale and restart workloads, read and patch environment from
ConfigMaps and Secrets, browse files inside PersistentVolumeClaims, and (when
configured) trigger builds and roll back deployments. We take security reports
seriously and appreciate responsible disclosure.

## Supported versions

inInfra is pre-1.0 and ships from `master`. Security fixes land on `master` and
in the latest `0.x` release; older `0.x` tags are not patched. Always run the
most recent release (or `master`).

| Version | Supported |
|---------|-----------|
| `0.1.x` (latest) | ✅ |
| `master` (HEAD) | ✅ |
| Older / pre-`0.1.0` | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately using **GitHub Security Advisories**:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** to open a private advisory draft.
3. Describe the issue with enough detail to reproduce (see below).

If you cannot use GitHub Security Advisories, email the maintainers at
**security@ininfra.example** *(placeholder — replace with your project's real
security contact before publishing)*.

A good report includes:

- The affected component (`apps/api`, `apps/web`, deploy manifests) and version
  or commit SHA.
- The impact (privilege escalation, auth bypass, info disclosure, RCE, etc.).
- Step-by-step reproduction, a proof-of-concept, and any relevant configuration
  (e.g. `MANAGED_NAMESPACES`, whether Jenkins/ECR are enabled).
- Your assessment of severity and any suggested remediation.

## Response expectations

- **Acknowledgement** within **3 business days**.
- An initial **assessment / triage** within **7 business days**.
- We will keep you updated on progress, agree on a coordinated disclosure
  timeline, and credit you in the advisory and `CHANGELOG.md` unless you prefer
  to remain anonymous.
- Once a fix is available we publish a GitHub Security Advisory and a patched
  release.

Please give us a reasonable window to ship a fix before any public disclosure.

## Security model (summary)

Understanding the model helps you scope reports. Details live in the
[README](README.md#security) and [docs/INSTALL.md](docs/INSTALL.md).

- **Password hashing.** Admin and console user passwords are hashed with
  **argon2id**. Plaintext is never stored or logged.
- **Sessions.** Login mints a stateless **HS256 JWT** carried in an `HttpOnly`,
  `Secure`, `SameSite=Lax` cookie (12-hour TTL). The token is not readable from
  JavaScript. Rotating `SESSION_SECRET` invalidates every outstanding session.
  `SESSION_SECRET` must be **>=32 random bytes**; the API refuses to boot with a
  shorter key. Always serve the console over **TLS** so the `Secure` cookie is
  honored.
- **Namespace allowlist.** The API only reads and patches the configured
  `MANAGED_NAMESPACES`. Mutating handlers validate the target namespace against
  the allowlist, so a crafted request cannot reach a namespace the operator did
  not opt in to.
- **Roles.** `viewer` accounts are read-only; any mutating request
  (POST/PUT/PATCH/DELETE) is rejected for non-admins, and user management is
  admin-only.
- **Least-privilege RBAC.** The API ServiceAccount is granted namespaced
  read/patch verbs only within the managed namespaces (plus the few extra verbs
  the mutating handlers require), and read-only cluster-scoped access to nodes,
  namespaces, and pods. It is not cluster-admin.

## Out of scope

- Vulnerabilities in your own cluster, Jenkins, registry, or network that are not
  caused by inInfra.
- Issues that require an already-compromised admin account or host.
- Running the console **without TLS** (the `Secure` cookie and session integrity
  assume TLS — this is a deployment requirement, not a product bug).
- Findings against the **example** `deploy/k8s/` manifests or
  `.github/workflows/deploy.yml`, which are templates meant to be edited for your
  infrastructure.
