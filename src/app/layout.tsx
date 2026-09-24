import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { ServiceWorker } from "@/components/shell/service-worker";
import { VercelInsights } from "@/components/shell/vercel-insights";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ServiceWorker />
        <VercelInsights />
      </body>
    </html>
  );
}
