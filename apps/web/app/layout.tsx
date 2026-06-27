import type { Metadata } from "next";
import { Red_Hat_Display, Red_Hat_Text, Red_Hat_Mono } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { ToastProvider } from "@/components/Toast";
import { ConfigProvider } from "@/components/ConfigProvider";
import { ActiveBuildIndicator } from "@/components/ActiveBuildIndicator";
import { LanguageProvider } from "@/lib/i18n";
import { getAppConfig } from "@/lib/config";

const rhText = Red_Hat_Text({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-rh-text",
  display: "swap",
});
const rhDisplay = Red_Hat_Display({
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  variable: "--font-rh-display",
  display: "swap",
});
const rhMono = Red_Hat_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-rh-mono",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  return {
    title: `${config.productName} · ${config.clusterName}`,
    description: `${config.productName} — operate the ${config.clusterName} cluster`,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = await getAppConfig();
  return (
    <html
      lang="en"
      className={`${rhText.variable} ${rhDisplay.variable} ${rhMono.variable}`}
    >
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">
        <ConfigProvider value={config}>
          <LanguageProvider>
            <ToastProvider>
              <Shell>{children}</Shell>
              <ActiveBuildIndicator />
            </ToastProvider>
          </LanguageProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
