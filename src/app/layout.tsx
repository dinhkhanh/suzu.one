import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ServiceWorker } from "@/components/shell/service-worker";
import { VercelInsights } from "@/components/shell/vercel-insights";
import { themeAttribute } from "@/theme/config";
import { getTheme } from "@/theme/server";
import "./globals.css";

// Inter ships a Vietnamese subset, so diacritics render in the same face as the rest of the UI.
const sans = Inter({ variable: "--font-sans", subsets: ["latin", "vietnamese"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin", "vietnamese"] });

export const metadata: Metadata = {
  title: { default: "SuZu One", template: "%s · SuZu One" },
  description: "SuZu Group internal operations platform",
  robots: { index: false, follow: false },
  // Installed on a phone: the home-screen name and icon on iOS (Android reads the manifest).
  appleWebApp: { capable: true, title: "SuZu One", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
};

// The browser chrome around the page matches the desk (`--canvas`): the device's own setting when
// the reader follows it, otherwise the one they chose.
const THEME_COLOR = { light: "#f4f4f3", dark: "#0a0a0a" } as const;

export async function generateViewport(): Promise<Viewport> {
  const forced = themeAttribute(await getTheme());
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: forced
      ? THEME_COLOR[forced]
      : [
          { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
          { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
        ],
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  // The reader's theme rides on <html> (see globals.css); absent, the device's setting decides.
  const theme = themeAttribute(await getTheme());
  return (
    <html lang={locale} data-theme={theme} className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ServiceWorker />
        <VercelInsights />
      </body>
    </html>
  );
}
