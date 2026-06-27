"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import { cx } from "@/lib/format";
import { Card } from "@/components/ui/card";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; text: string };

const ToastCtx = createContext<(tone: Tone, text: string) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: Tone, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <Card
            key={t.id}
            className={cx(
              "pointer-events-auto animate-fade-in rounded-md px-4 py-2.5 text-sm shadow-lg backdrop-blur",
              t.tone === "success" &&
                "border-pf-green/30 bg-pf-green-50 text-pf-green",
              t.tone === "error" &&
                "border-pf-red/30 bg-pf-red-50 text-pf-red",
              t.tone === "info" &&
                "border-line bg-white text-ink shadow-card",
            )}
          >
            {t.text}
          </Card>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
