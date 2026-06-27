"use client";

import { createContext, useContext } from "react";
import type { AppConfig } from "@ininfra/shared-types";

const ConfigContext = createContext<AppConfig | null>(null);

/**
 * Makes the server-fetched public {@link AppConfig} available to client
 * components below the console chrome. Wrap the Shell subtree in layout.tsx.
 */
export function ConfigProvider({
  value,
  children,
}: {
  value: AppConfig;
  children: React.ReactNode;
}) {
  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}

/** Read the runtime {@link AppConfig}. Must be used under a `<ConfigProvider>`. */
export function useConfig(): AppConfig {
  const ctx = useContext(ConfigContext);
  if (ctx === null) {
    throw new Error("useConfig must be used within a <ConfigProvider>");
  }
  return ctx;
}
