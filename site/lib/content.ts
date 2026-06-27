import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  SlidersHorizontal,
  ScrollText,
  FolderTree,
  GitBranch,
  Gauge,
  Server,
  Network,
  Users,
  ClipboardList,
  Bug,
  Activity,
} from "lucide-react";

export const site = {
  name: "inInfra",
  tagline: "An operations console for any Kubernetes cluster.",
  repo: "https://github.com/AE52/ininfra",
  license: "Apache-2.0",
} as const;

export const nav = {
  links: [
    { label: "Features", href: "#features" },
    { label: "How it works", href: "#how" },
    { label: "Quickstart", href: "#quickstart" },
  ],
} as const;

export const hero = {
  eyebrow: "OPEN SOURCE · APACHE 2.0 · SELF-HOSTABLE",
  headlineLead: "Operate any cluster from",
  headlineKeyword: "one console",
  deck:
    "inInfra is a self-hostable, OpenShift-style web console for any Kubernetes cluster. Scale and restart workloads, edit env from ConfigMaps and Secrets, stream logs, trigger and roll back deploys — every change audited to Postgres.",
  primaryCta: { label: "Get started", href: "#quickstart" },
  secondaryCta: { label: "View on GitHub", href: site.repo },
} as const;

// Lines typed out by the AnimatedTerminal — the real quickstart.
export const terminalLines: { text: string; tone?: "cmd" | "out" | "ok" }[] = [
  { text: "$ docker build -f deploy/Dockerfile.api -t reg/ininfra-api .", tone: "cmd" },
  { text: "$ docker build -f deploy/Dockerfile.web -t reg/ininfra-web .", tone: "cmd" },
  { text: "  => pushed reg/ininfra-api  reg/ininfra-web", tone: "out" },
  { text: "$ kubectl apply -f deploy/k8s/", tone: "cmd" },
  { text: "  namespace/ininfra created", tone: "out" },
  { text: "  deployment.apps/ininfra-api created", tone: "out" },
  { text: "  deployment.apps/ininfra-web created", tone: "out" },
  { text: "✓ console ready — https://console.your-cluster", tone: "ok" },
];

export const trustFacts: string[] = [
  "RUST + NEXT.JS",
  "APACHE-2.0",
  "AUDITED TO POSTGRES",
  "LEAST-PRIVILEGE RBAC",
  "NO GITOPS LOCK-IN",
];

export type Feature = {
  kicker: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  span?: "wide";
};

export const features: Feature[] = [
  {
    kicker: "WORKLOADS",
    title: "Scale & restart",
    desc:
      "List Deployments and StatefulSets across managed namespaces, view detail, scale replicas, and trigger rolling restarts.",
    icon: Boxes,
    span: "wide",
  },
  {
    kicker: "ENV",
    title: "Edit ConfigMaps & Secrets",
    desc:
      "Patch container env from ConfigMaps and Secrets — secret values masked, optimistic concurrency via resourceVersion.",
    icon: SlidersHorizontal,
  },
  {
    kicker: "LOGS",
    title: "Live log streaming",
    desc:
      "List pods, restart a pod, read a snapshot, and stream logs live over Server-Sent Events.",
    icon: ScrollText,
  },
  {
    kicker: "STORAGE",
    title: "PVC file browser",
    desc:
      "Browse, read, write, and delete files inside a PersistentVolumeClaim by exec-ing into the mounting pod.",
    icon: FolderTree,
  },
  {
    kicker: "DEPLOYS",
    title: "Builds, commits & rollback",
    desc:
      "Trigger and track Jenkins builds, resolve the git commit actually deployed from image tags, and roll back.",
    icon: GitBranch,
    span: "wide",
  },
  {
    kicker: "AUTOSCALING",
    title: "View & edit HPAs",
    desc: "Inspect and adjust HorizontalPodAutoscalers without leaving the console.",
    icon: Gauge,
  },
  {
    kicker: "NODES",
    title: "Cluster node inventory",
    desc: "See every node and the pods scheduled on it, cluster-wide.",
    icon: Server,
  },
  {
    kicker: "NETWORK",
    title: "Services & ingresses",
    desc: "See exactly how each workload is exposed.",
    icon: Network,
  },
  {
    kicker: "ACCESS",
    title: "Users & roles",
    desc: "Create console users with admin or viewer roles. Viewers read; only admins mutate.",
    icon: Users,
  },
  {
    kicker: "AUDIT",
    title: "Cursor-paginated audit log",
    desc:
      "A time-ordered record of every mutating action, attributed to the acting user.",
    icon: ClipboardList,
  },
  {
    kicker: "ERRORS",
    title: "Sentry-style error feed",
    desc: "A live feed of captured client and API errors.",
    icon: Bug,
  },
  {
    kicker: "STATUS",
    title: "Atlassian-style status page",
    desc:
      "A status page backed by a background monitor that records component health transitions.",
    icon: Activity,
  },
];

export const steps = [
  {
    no: "01",
    title: "Connect",
    desc:
      "Point inInfra at your cluster via a ServiceAccount in-cluster or your kube context locally. RBAC is scoped to your MANAGED_NAMESPACES allowlist.",
  },
  {
    no: "02",
    title: "Operate",
    desc:
      "Scale and restart workloads, edit env, stream logs, browse PVC files, trigger Jenkins builds, and roll back deploys — all from the browser.",
  },
  {
    no: "03",
    title: "Audit",
    desc:
      "Every mutation is recorded to Postgres and attributed to the acting user, exposed as a cursor-paginated audit log.",
  },
] as const;

export const consoleTabs = ["Workloads", "Logs", "Deploys", "Status"] as const;
export type ConsoleTab = (typeof consoleTabs)[number];

export const security = [
  {
    title: "argon2id password hashing",
    desc: "Admin and user passwords are hashed with argon2id — plaintext is never stored or logged.",
  },
  {
    title: "HS256 HttpOnly session cookie",
    desc: "Login mints a stateless HS256 JWT in an HttpOnly, Secure, SameSite=Lax cookie with a 12h TTL.",
  },
  {
    title: "Namespace allowlist",
    desc: "The API only reads and patches the configured MANAGED_NAMESPACES; mutating handlers validate the target.",
  },
  {
    title: "Role enforcement",
    desc: "Viewer accounts read only — any POST/PUT/PATCH/DELETE is rejected for non-admins.",
  },
  {
    title: "Least-privilege RBAC",
    desc: "The ServiceAccount gets namespaced read/patch in managed namespaces and read-only cluster-scoped access.",
  },
] as const;

export const quickstart = {
  steps: [
    {
      label: "Build & push images",
      lang: "bash",
      code: `docker build -f deploy/Dockerfile.api \\
  -t your-registry/ininfra-api:latest .
docker build -f deploy/Dockerfile.web \\
  -t your-registry/ininfra-web:latest .

docker push your-registry/ininfra-api:latest
docker push your-registry/ininfra-web:latest`,
    },
    {
      label: "Namespace + auth secret",
      lang: "bash",
      code: `kubectl create namespace your-namespace

kubectl -n your-namespace create secret generic ininfra-auth \\
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \\
  --from-literal=ADMIN_USERNAME='admin' \\
  --from-literal=ADMIN_PASSWORD='choose-a-strong-password'`,
    },
    {
      label: "Deploy",
      lang: "bash",
      code: `kubectl apply -f deploy/k8s/

kubectl -n your-namespace get pods
kubectl -n your-namespace logs deploy/ininfra-api`,
    },
  ],
  env: [
    { name: "DATABASE_URL", note: "Postgres connection string" },
    { name: "SESSION_SECRET", note: ">=32 random bytes" },
    { name: "MANAGED_NAMESPACES", note: "CSV allowlist (default: default)" },
    { name: "API_INTERNAL_URL", note: "in-cluster URL of the api" },
  ],
} as const;

export const cta = {
  title: "Your cluster. Your data. Your console.",
  desc:
    "inInfra is a thin operations console — not a cluster installer or a GitOps engine. Self-host it, point it at your own cluster and registry, and run it.",
  primary: { label: "Get started", href: "#quickstart" },
  secondary: { label: "View on GitHub", href: site.repo },
} as const;

export const footer = {
  blurb:
    "A self-hostable, OpenShift-style operations console for any Kubernetes cluster. Rust + Next.js. Apache-2.0.",
  columns: [
    {
      heading: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "How it works", href: "#how" },
        { label: "Quickstart", href: "#quickstart" },
      ],
    },
    {
      heading: "Project",
      links: [
        { label: "GitHub", href: site.repo },
        { label: "License (Apache-2.0)", href: "https://github.com/AE52/ininfra/blob/main/LICENSE" },
        { label: "Issues", href: "https://github.com/AE52/ininfra/issues" },
      ],
    },
  ],
} as const;
