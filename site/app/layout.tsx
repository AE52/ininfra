import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "inInfra — an operations console for any Kubernetes cluster",
  description:
    "Open-source, self-hostable, OpenShift-style web console for any Kubernetes cluster. Scale workloads, edit env, stream logs, deploy and roll back — every change audited to Postgres. Rust + Next.js. Apache-2.0.",
  applicationName: "inInfra",
  keywords: [
    "Kubernetes",
    "operations console",
    "OpenShift alternative",
    "self-hosted",
    "Rust",
    "Next.js",
    "open source",
  ],
  metadataBase: new URL("https://ae52.github.io"),
};

export const viewport = {
  themeColor: "#07090E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
    >
      <body className="bg-base text-ink antialiased">{children}</body>
    </html>
  );
}
