"use client";

import { cn } from "@/lib/utils";
import { Logo, Wordmark } from "@/components/Brand";
import { Input } from "@/components/ui/input";
import type { SetupStatus } from "@ininfra/shared-types";

/* ------------------------------------------------------------------ */
/* Wizard state shape (shared across steps)                            */
/* ------------------------------------------------------------------ */

export interface WizardData {
  productName: string;
  clusterName: string;
  namespaces: string[]; // available namespaces fetched from the cluster
  managedNamespaces: string[]; // selected
  cicdNamespace: string | null;
  features: { jenkins: boolean; gateway: boolean; ecr: boolean };
  username: string;
  password: string;
  confirm: string;
}

/* ------------------------------------------------------------------ */
/* Small shared primitives, tuned for the wizard                       */
/* ------------------------------------------------------------------ */

/** Section heading inside a step body. */
export function StepHeading({
  kicker,
  title,
  description,
}: {
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-6">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-pf-blue">
        {kicker}
      </div>
      <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-ink">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">{description}</p>
    </header>
  );
}

/** Field label + child input + optional hint / inline error. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-semibold text-ink"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-pf-red">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Welcome & branding                                         */
/* ------------------------------------------------------------------ */

export function WelcomeStep({
  data,
  set,
}: {
  data: WizardData;
  set: (patch: Partial<WizardData>) => void;
}) {
  const name = data.productName.trim() || "inInfra";
  return (
    <div>
      <StepHeading
        kicker="Welcome"
        title="Name your console"
        description="Set the brand and cluster name shown across the console. You can change these later in settings."
      />

      <Field
        label="Product name"
        htmlFor="setup-product"
        hint="The brand shown in the masthead and login. Default: inInfra."
      >
        <Input
          id="setup-product"
          value={data.productName}
          autoFocus
          placeholder="inInfra"
          onChange={(e) => set({ productName: e.target.value })}
        />
      </Field>

      <Field
        label="Cluster display name"
        htmlFor="setup-cluster"
        hint="A human-friendly label for this cluster, e.g. production-eu."
      >
        <Input
          id="setup-cluster"
          value={data.clusterName}
          placeholder="production"
          onChange={(e) => set({ clusterName: e.target.value })}
        />
      </Field>

      {/* Live preview — a miniature of the masthead band the user is naming. */}
      <div className="mt-7">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
          Preview
        </div>
        <div className="overflow-hidden rounded-lg border border-line shadow-card">
          <div className="flex h-14 items-center gap-2.5 bg-masthead px-4">
            <Logo size={28} />
            <div className="leading-none">
              {name === "inInfra" ? (
                <Wordmark className="text-[16px] text-white" />
              ) : (
                <span className="font-display text-[16px] font-semibold tracking-tight text-white">
                  {name}
                </span>
              )}
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/45">
                {data.clusterName.trim() || "cluster"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Cluster & namespaces                                       */
/* ------------------------------------------------------------------ */

const MODE_LABEL: Record<SetupStatus["detectedClusterMode"], string> = {
  "in-cluster": "In-cluster service account",
  kubeconfig: "Local kubeconfig",
  unknown: "Not detected",
};

export function NamespacesStep({
  data,
  set,
  status,
  loading,
  error,
}: {
  data: WizardData;
  set: (patch: Partial<WizardData>) => void;
  status: SetupStatus | null;
  loading: boolean;
  error: string | null;
}) {
  const mode = status?.detectedClusterMode ?? "unknown";

  function toggleNs(ns: string) {
    const has = data.managedNamespaces.includes(ns);
    const next = has
      ? data.managedNamespaces.filter((n) => n !== ns)
      : [...data.managedNamespaces, ns];
    // Keep the CI/CD namespace valid: default to the first selected, drop if removed.
    let cicd = data.cicdNamespace;
    if (cicd && !next.includes(cicd)) cicd = next[0] ?? null;
    if (!cicd && next.length > 0) cicd = next[0];
    set({ managedNamespaces: next, cicdNamespace: cicd });
  }

  return (
    <div>
      <StepHeading
        kicker="Cluster"
        title="Choose managed namespaces"
        description="Pick the namespaces this console may read and operate on. Everything else in the cluster stays out of view."
      />

      {/* Detected connection mode — read-only context. */}
      <div className="mb-6 flex items-center justify-between rounded-lg border border-line bg-line-soft/60 px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            Cluster connection
          </div>
          <div className="mt-0.5 text-sm font-medium text-ink">
            {MODE_LABEL[mode]}
          </div>
        </div>
        <span
          className={cn(
            "rounded-pf px-2 py-1 font-mono text-[11px]",
            mode === "unknown"
              ? "bg-pf-gold-50 text-pf-gold"
              : "bg-pf-green-50 text-pf-green",
          )}
        >
          {mode}
        </span>
      </div>

      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">
          Managed namespaces
        </span>
        <span className="text-xs text-ink-faint">
          {data.managedNamespaces.length} selected
        </span>
      </div>

      {loading ? (
        <div className="rounded-lg border border-line px-4 py-8 text-center text-sm text-ink-muted">
          Loading namespaces…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-pf-red/30 bg-pf-red-50 px-4 py-3 text-sm text-pf-red">
          {error}
        </div>
      ) : data.namespaces.length === 0 ? (
        <div className="rounded-lg border border-line px-4 py-8 text-center text-sm text-ink-muted">
          No namespaces returned by the cluster. Check the API&apos;s cluster
          access, then reload.
        </div>
      ) : (
        <div
          role="group"
          aria-label="Managed namespaces"
          className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg border border-line p-2 sm:grid-cols-2"
        >
          {data.namespaces.map((ns) => {
            const selected = data.managedNamespaces.includes(ns);
            return (
              <button
                key={ns}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleNs(ns)}
                className={cn(
                  "flex items-center gap-2.5 rounded-pf px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  selected
                    ? "bg-pf-blue-50 text-ink ring-1 ring-pf-blue/30"
                    : "text-ink-soft hover:bg-line-soft",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border",
                    selected
                      ? "border-pf-blue bg-pf-blue text-white"
                      : "border-line bg-white",
                  )}
                  aria-hidden
                >
                  {selected && (
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
                      <path
                        d="M3.5 8.5l3 3 6-6.5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span className="truncate font-mono">{ns}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* CI/CD namespace — only meaningful once something is selected. */}
      <div className="mt-6">
        <Field
          label="CI/CD namespace"
          htmlFor="setup-cicd"
          hint="Where build pipelines (Argo) run. Defaults to the first managed namespace."
        >
          <select
            id="setup-cicd"
            value={data.cicdNamespace ?? ""}
            disabled={data.managedNamespaces.length === 0}
            onChange={(e) =>
              set({ cicdNamespace: e.target.value || null })
            }
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">None</option>
            {data.managedNamespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Features                                                   */
/* ------------------------------------------------------------------ */

const FEATURES: {
  key: keyof WizardData["features"];
  title: string;
  desc: string;
}[] = [
  {
    key: "jenkins",
    title: "Jenkins builds",
    desc: "Trigger and track CI builds from the console.",
  },
  {
    key: "gateway",
    title: "API gateway",
    desc: "View gateway access logs and edit the gateway config.",
  },
  {
    key: "ecr",
    title: "Amazon ECR",
    desc: "Browse image tags, resolve commits, and prune unused images.",
  },
];

export function FeaturesStep({
  data,
  set,
}: {
  data: WizardData;
  set: (patch: Partial<WizardData>) => void;
}) {
  function toggle(key: keyof WizardData["features"]) {
    set({ features: { ...data.features, [key]: !data.features[key] } });
  }

  return (
    <div>
      <StepHeading
        kicker="Integrations"
        title="Turn on what you use"
        description="Enable only the integrations this cluster has configured. Each can be toggled later in settings."
      />

      <div className="space-y-2">
        {FEATURES.map((f) => {
          const on = data.features[f.key];
          return (
            <button
              key={f.key}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => toggle(f.key)}
              className={cn(
                "flex w-full items-center gap-4 rounded-lg border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                on
                  ? "border-pf-blue/40 bg-pf-blue-50"
                  : "border-line hover:bg-line-soft",
              )}
            >
              <div className="flex-1">
                <div className="text-sm font-semibold text-ink">{f.title}</div>
                <div className="mt-0.5 text-xs text-ink-muted">{f.desc}</div>
              </div>
              <span
                className={cn(
                  "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                  on ? "bg-pf-blue" : "bg-line",
                )}
                aria-hidden
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                    on ? "translate-x-[18px]" : "translate-x-0.5",
                  )}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — Create admin                                               */
/* ------------------------------------------------------------------ */

/** 0..3 strength buckets from simple length/variety heuristics. */
export function passwordStrength(pw: string): {
  score: 0 | 1 | 2 | 3;
  label: string;
} {
  if (pw.length < 8) return { score: 0, label: "Too short" };
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/[0-9]/.test(pw)) variety++;
  if (/[^A-Za-z0-9]/.test(pw)) variety++;
  if (pw.length >= 12 && variety >= 3) return { score: 3, label: "Strong" };
  if (variety >= 3) return { score: 2, label: "Good" };
  return { score: 1, label: "Fair" };
}

export function AdminStep({
  data,
  set,
  errors,
}: {
  data: WizardData;
  set: (patch: Partial<WizardData>) => void;
  errors: { username?: string; password?: string; confirm?: string };
}) {
  const strength = passwordStrength(data.password);
  const STRENGTH_COLOR = ["bg-line", "bg-pf-red", "bg-pf-gold", "bg-pf-green"];

  return (
    <div>
      <StepHeading
        kicker="First account"
        title="Create the admin"
        description="This is the first console account. It gets the highest admin role — you can add more users after setup."
      />

      <Field label="Username" htmlFor="setup-admin-user" error={errors.username}>
        <Input
          id="setup-admin-user"
          autoFocus
          autoComplete="username"
          value={data.username}
          onChange={(e) => set({ username: e.target.value })}
        />
      </Field>

      <Field
        label="Password"
        htmlFor="setup-admin-pw"
        error={errors.password}
        hint="At least 8 characters. A longer mix of cases, digits, and symbols is stronger."
      >
        <Input
          id="setup-admin-pw"
          type="password"
          autoComplete="new-password"
          value={data.password}
          onChange={(e) => set({ password: e.target.value })}
        />
        {data.password.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    i < strength.score
                      ? STRENGTH_COLOR[strength.score]
                      : "bg-line",
                  )}
                />
              ))}
            </div>
            <span className="w-16 text-right text-[11px] font-medium text-ink-muted">
              {strength.label}
            </span>
          </div>
        )}
      </Field>

      <Field
        label="Confirm password"
        htmlFor="setup-admin-confirm"
        error={errors.confirm}
      >
        <Input
          id="setup-admin-confirm"
          type="password"
          autoComplete="new-password"
          value={data.confirm}
          onChange={(e) => set({ confirm: e.target.value })}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 5 — Review & finish                                            */
/* ------------------------------------------------------------------ */

function ReviewRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

export function ReviewStep({ data }: { data: WizardData }) {
  const enabled = (
    Object.keys(data.features) as (keyof WizardData["features"])[]
  ).filter((k) => data.features[k]);

  return (
    <div>
      <StepHeading
        kicker="Review"
        title="Confirm and finish"
        description="Check the configuration below. Finishing writes it to the database and creates the admin account."
      />

      <div className="rounded-lg border border-line px-4 py-1">
        <ReviewRow label="Product name">
          {data.productName.trim() || "inInfra"}
        </ReviewRow>
        <ReviewRow label="Cluster name">
          {data.clusterName.trim() || "—"}
        </ReviewRow>
        <ReviewRow label="Managed namespaces">
          <span className="font-mono">
            {data.managedNamespaces.join(", ") || "—"}
          </span>
        </ReviewRow>
        <ReviewRow label="CI/CD namespace">
          <span className="font-mono">{data.cicdNamespace ?? "None"}</span>
        </ReviewRow>
        <ReviewRow label="Integrations">
          {enabled.length === 0 ? "None" : enabled.join(", ")}
        </ReviewRow>
        <ReviewRow label="Admin user">
          <span className="font-mono">{data.username || "—"}</span>
        </ReviewRow>
      </div>
    </div>
  );
}
