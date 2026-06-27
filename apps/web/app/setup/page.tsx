"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Logo, Wordmark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { SetupStatus, SetupCompleteRequest } from "@ininfra/shared-types";
import {
  AdminStep,
  FeaturesStep,
  NamespacesStep,
  ReviewStep,
  WelcomeStep,
  type WizardData,
} from "./steps";

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "cluster", label: "Cluster" },
  { id: "features", label: "Integrations" },
  { id: "admin", label: "Admin" },
  { id: "review", label: "Review" },
] as const;

const EMPTY: WizardData = {
  productName: "inInfra",
  clusterName: "",
  namespaces: [],
  managedNamespaces: [],
  cicdNamespace: null,
  features: { jenkins: false, gateway: false, ecr: false },
  username: "",
  password: "",
  confirm: "",
};

export default function SetupPage() {
  const router = useRouter();

  // gate: undefined = checking, false = wizard runs, true = bounce to /login
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(EMPTY);
  const [nsLoading, setNsLoading] = useState(false);
  const [nsError, setNsError] = useState<string | null>(null);
  const [nsLoaded, setNsLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showAdminErrors, setShowAdminErrors] = useState(false);

  const set = (patch: Partial<WizardData>) =>
    setData((d) => ({ ...d, ...patch }));

  // ── Gate on mount: only run when setup is actually needed. ──────────────
  useEffect(() => {
    let alive = true;
    api
      .getSetupStatus()
      .then((s) => {
        if (!alive) return;
        if (!s.needsSetup) {
          router.replace("/login");
          return;
        }
        setStatus(s);
        // Seed branding defaults from the API's current effective values.
        setData((d) => ({
          ...d,
          productName: s.productName || d.productName,
          clusterName: s.clusterName || d.clusterName,
        }));
        setReady(true);
      })
      .catch(() => {
        // Status is public and always available; if it fails, the API is down.
        // Let the user try anyway — show the wizard with unknown cluster mode.
        if (!alive) return;
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [router]);

  // ── Fetch namespaces lazily when first reaching the cluster step. ───────
  useEffect(() => {
    if (step !== 1 || nsLoaded) return;
    let alive = true;
    setNsLoading(true);
    setNsError(null);
    api
      .getSetupNamespaces()
      .then((res) => {
        if (!alive) return;
        setData((d) => ({ ...d, namespaces: res.namespaces }));
        setNsLoaded(true);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiClientError && e.status === 409) {
          // Setup got completed elsewhere — funnel to login.
          router.replace("/login");
          return;
        }
        setNsError(
          e instanceof ApiClientError
            ? e.message
            : "Could not list cluster namespaces.",
        );
        setNsLoaded(true);
      })
      .finally(() => {
        if (alive) setNsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [step, nsLoaded, router]);

  // ── Per-step validation gating the Next/Finish button. ──────────────────
  const adminErrors = useMemo(() => {
    const e: { username?: string; password?: string; confirm?: string } = {};
    if (!data.username.trim()) e.username = "Enter a username.";
    if (data.password.length < 8)
      e.password = "Password must be at least 8 characters.";
    if (data.confirm !== data.password)
      e.confirm = "Passwords do not match.";
    return e;
  }, [data.username, data.password, data.confirm]);

  const stepValid = useMemo(() => {
    switch (step) {
      case 0:
        return data.clusterName.trim().length > 0;
      case 1:
        return data.managedNamespaces.length >= 1;
      case 2:
        return true;
      case 3:
        return Object.keys(adminErrors).length === 0;
      case 4:
        return (
          data.managedNamespaces.length >= 1 &&
          data.clusterName.trim().length > 0 &&
          Object.keys(adminErrors).length === 0
        );
      default:
        return false;
    }
  }, [step, data, adminErrors]);

  function next() {
    if (step === 3 && !stepValid) {
      setShowAdminErrors(true);
      return;
    }
    if (!stepValid) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setSubmitError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function finish() {
    if (!stepValid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const body: SetupCompleteRequest = {
      productName: data.productName.trim() || "inInfra",
      clusterName: data.clusterName.trim(),
      managedNamespaces: data.managedNamespaces,
      cicdNamespace: data.cicdNamespace,
      features: data.features,
      admin: { username: data.username.trim(), password: data.password },
    };
    try {
      await api.completeSetup(body);
      router.replace("/login");
    } catch (e: unknown) {
      if (e instanceof ApiClientError && e.status === 409) {
        // Already set up — nothing more to do here.
        router.replace("/login");
        return;
      }
      setSubmitError(
        e instanceof ApiClientError
          ? e.message
          : "Could not complete setup. Check the API and try again.",
      );
      setSubmitting(false);
    }
  }

  const productName = data.productName.trim() || "inInfra";
  const isLast = step === STEPS.length - 1;

  if (!ready) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas text-sm text-ink-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-canvas">
      {/* Dark brand band, echoing the console masthead. */}
      <div className="flex h-[120px] shrink-0 items-end bg-masthead px-6 pb-6 sm:px-10">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          {productName === "inInfra" ? (
            <Wordmark className="text-2xl text-white" />
          ) : (
            <span className="font-display text-2xl font-semibold tracking-tight text-white">
              {productName}
            </span>
          )}
          <span className="ml-1 rounded-pf bg-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/70">
            Setup
          </span>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center px-4 py-10 sm:py-12">
        <div className="w-full max-w-xl">
          {/* Stepper */}
          <ol className="mb-6 flex items-center gap-2" aria-label="Setup progress">
            {STEPS.map((s, i) => {
              const state =
                i < step ? "done" : i === step ? "current" : "upcoming";
              return (
                <li key={s.id} className="flex flex-1 items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                        state === "done" && "bg-pf-blue text-white",
                        state === "current" &&
                          "bg-pf-blue text-white ring-4 ring-pf-blue/20",
                        state === "upcoming" && "bg-line text-ink-faint",
                      )}
                      aria-current={state === "current" ? "step" : undefined}
                    >
                      {state === "done" ? (
                        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
                          <path
                            d="M3.5 8.5l3 3 6-6.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span
                      className={cn(
                        "hidden text-xs font-medium sm:inline",
                        state === "upcoming" ? "text-ink-faint" : "text-ink",
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <span
                      className={cn(
                        "h-px flex-1",
                        i < step ? "bg-pf-blue" : "bg-line",
                      )}
                      aria-hidden
                    />
                  )}
                </li>
              );
            })}
          </ol>

          <Card className="p-6 sm:p-8">
            {step === 0 && <WelcomeStep data={data} set={set} />}
            {step === 1 && (
              <NamespacesStep
                data={data}
                set={set}
                status={status}
                loading={nsLoading}
                error={nsError}
              />
            )}
            {step === 2 && <FeaturesStep data={data} set={set} />}
            {step === 3 && (
              <AdminStep
                data={data}
                set={set}
                errors={showAdminErrors ? adminErrors : {}}
              />
            )}
            {step === 4 && <ReviewStep data={data} />}

            {submitError && (
              <div className="mt-6 flex items-start gap-2 rounded-pf border border-pf-red/30 bg-pf-red-50 px-3 py-2 text-xs text-pf-red">
                <svg
                  viewBox="0 0 24 24"
                  className="mt-px h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
                </svg>
                {submitError}
              </div>
            )}

            {/* Footer actions */}
            <div className="mt-8 flex items-center justify-between border-t border-line pt-5">
              <Button
                type="button"
                variant="ghost"
                onClick={back}
                disabled={step === 0 || submitting}
                className={cn(step === 0 && "invisible")}
              >
                Back
              </Button>

              <div className="flex items-center gap-3">
                <span className="text-xs text-ink-faint">
                  Step {step + 1} of {STEPS.length}
                </span>
                {isLast ? (
                  <Button
                    type="button"
                    onClick={finish}
                    disabled={!stepValid || submitting}
                  >
                    {submitting ? "Finishing…" : "Finish setup"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={next}
                    disabled={step !== 3 && !stepValid}
                  >
                    Continue
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <p className="mt-4 text-center text-xs text-ink-faint">
            This one-time wizard configures the console and creates the first
            admin. {passwordHintFor(step)}
          </p>
        </div>
      </div>
    </div>
  );
}

/** A small contextual footnote that changes with the active step. */
function passwordHintFor(step: number): string {
  switch (step) {
    case 1:
      return "Select at least one namespace to continue.";
    case 3:
      return "The password must be at least 8 characters.";
    default:
      return "";
  }
}
