"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Logo, Wordmark } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The login page renders outside the ConfigProvider, so fetch config itself.
  const [productName, setProductName] = useState("inInfra");
  const [clusterName, setClusterName] = useState("");

  useEffect(() => {
    let alive = true;
    // First-run funnel: edge middleware can't reach the DB, so the login page
    // checks setup status and bounces a fresh install to the wizard.
    api
      .getSetupStatus()
      .then((s) => {
        if (!alive) return;
        if (s.needsSetup) router.replace("/setup");
      })
      .catch(() => {});
    api
      .getConfig()
      .then((c) => {
        if (!alive) return;
        setProductName(c.productName);
        setClusterName(c.clusterName);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? t.login.errorBadCreds
            : t.login.errorGeneric(res.status),
        );
        setLoading(false);
        return;
      }
      // Cookie is set; go to the dashboard. refresh() re-runs SSR with the cookie.
      router.replace("/");
      router.refresh();
    } catch {
      setError(t.login.errorNetwork);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      {/* Dark brand band, echoing the console masthead. */}
      <div className="flex h-[120px] items-end bg-masthead px-6 pb-6 sm:px-10">
        <div className="flex flex-1 items-center gap-3">
          <Logo size={40} />
          {productName === "inInfra" ? (
            <Wordmark className="text-2xl text-white" />
          ) : (
            <span className="font-display text-2xl font-semibold tracking-tight text-white">
              {productName}
            </span>
          )}
        </div>
        {/* Language toggle on the login page */}
        <div className="ml-auto">
          <LanguageToggle />
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pt-12 sm:pt-20">
        <Card className="w-full max-w-sm p-6">
          <form onSubmit={onSubmit}>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
              {t.login.title}
            </h1>
            <p className="mb-7 mt-1.5 text-sm text-ink-muted">
              {clusterName ? (
                <>
                  <span className="font-mono">{clusterName}</span>{" "}
                  {t.login.clusterConsole}
                </>
              ) : (
                t.login.clusterConsole
              )}
            </p>

            <label className="mb-1.5 block text-sm font-semibold text-ink">
              {t.login.username}
            </label>
            <Input
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mb-4"
            />

            <label className="mb-1.5 block text-sm font-semibold text-ink">
              {t.login.password}
            </label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-5"
            />

            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-pf border border-pf-red/30 bg-pf-red-50 px-3 py-2 text-xs text-pf-red">
                <svg viewBox="0 0 24 24" className="mt-px h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                  <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" strokeLinecap="round" />
                </svg>
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full"
            >
              {loading ? t.login.submitting : t.login.submit}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
