import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { headers } from "next/headers";
import { ServiceWorker } from "@/components/shell/service-worker";
import { VercelInsights } from "@/components/shell/vercel-insights";
import { SHELL_NAMESPACES } from "@/i18n/route-namespaces.generated";
import { namespacesForSurface, pickMessages, PUBLIC_SITE_HEADER, SURFACE_HEADER } from "@/i18n/surfaces";
import { themeAttribute } from "@/theme/config";
import { getTheme } from "@/theme/server";
import "./globals.css";

// Be Vietnam Pro was drawn for Vietnamese first, so diacritics sit in the face rather than being
// bolted on; four weights cover body, labels and titles. JetBrains Mono for keys, times and money.
const sans = Be_Vietnam_Pro({ variable: "--font-sans", weight: ["400", "500", "600", "700"], subsets: ["latin", "vietnamese"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin", "vietnamese"], display: "swap" });

const icons: Metadata["icons"] = { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] };

/**
 * The words the browser is handed here. A public page's are already only its own
 * (`src/i18n/request.ts`). An app page gets the shell's here, and each section of the app adds what
 * its client components use in its own layout (`src/i18n/segment-messages.tsx`) — never the whole
 * catalogue, which is most of a megabyte (PERF-01). Server components still read all of it.
 */
async function clientMessages(): Promise<Record<string, unknown> | undefined> {
  if (namespacesForSurface((await headers()).get(SURFACE_HEADER)) !== null) return undefined;
  return pickMessages((await getMessages()) as Record<string, unknown>, SHELL_NAMESPACES);
}

/** Whether the proxy put this request on the public domain (`src/lib/site-routing.ts`). */
const onPublicSite = async () => (await headers()).get(PUBLIC_SITE_HEADER) === "1";

export async function generateMetadata(): Promise<Metadata> {
  // The public domain never names the internal app: not in a tab title, a description, the web
  // manifest or a home-screen name. Its pages set their own titles on top of this.
  if (await onPublicSite()) return { title: { default: "SuZu Group", template: "%s · SuZu Group" }, robots: { index: false, follow: false }, manifest: null, icons };
  return {
    title: { default: "SuZu One", template: "%s · SuZu One" },
    description: "SuZu Group internal operations platform",
    robots: { index: false, follow: false },
    // Installed on a phone: the home-screen name and icon on iOS (Android reads the manifest).
    appleWebApp: { capable: true, title: "SuZu One", statusBarStyle: "default" },
    icons,
  };
}

// The browser chrome around the page matches the desk (`--canvas`): the device's own setting when
// the reader follows it, otherwise the one they chose.
const THEME_COLOR = { light: "#fafaf9", dark: "#141413" } as const;

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
  const publicSite = await onPublicSite();
  const messages = await clientMessages();
  return (
    <html lang={locale} data-theme={theme} className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        <NextIntlClientProvider messages={messages as Parameters<typeof NextIntlClientProvider>[0]["messages"]}>{children}</NextIntlClientProvider>
        {/* Nothing on the public domain is the installable app: no worker outlives a visit there. */}
        {publicSite ? null : <ServiceWorker />}
        <VercelInsights />
      </body>
    </html>
  );
}
